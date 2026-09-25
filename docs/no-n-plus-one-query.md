# no-n-plus-one-query / 禁止在热路径中逐条查询（N+1 查询）

## 1. 目的
- 先查出一批数据，再在循环或 `map` 回调里为每一条单独查一次关联数据，就是典型的 N+1 查询：集合有 N 条，就产生 N 次数据库/缓存往返。数据量一大，接口延迟、数据库负载与连接池占用都随之线性放大。
- 把逐条查询改成 `Promise.all(ids.map(...))` 并不能解决问题：往返次数不变，还会瞬间占满连接池。正确的做法是一次批量查询（`IN` / `$in` / `findMany` / `mget`），再在内存中按 key 分发。
- ESLint 生态里只有通用的 `no-await-in-loop`，既不认识数据访问 API，也看不到 `map` 回调里的查询；本规则专门识别这类往返。

## 2. 适用范围
- 按数据逐条迭代的热路径：`for...of` / `for...in`、条件里出现 `.length` / `.size` 的 `for` 循环、数组高阶方法回调（`map` / `forEach` / `filter` / `reduce` 等），以及它们内部嵌套的循环与回调。
- 识别的数据访问（按 API 形态识别，不做类型推断）：
  - 辨识度高的 ORM / 驱动方法：`findUnique` / `findFirst` / `findMany`（Prisma）、`findById` / `findOne` / `findOneAndUpdate` / `countDocuments`（Mongoose、MongoDB）、`findByPk` / `findAll` / `findOrCreate`（Sequelize）、`findOneBy` / `findOneOrFail` / `findAndCount`（TypeORM）、`$queryRaw` / `$executeRaw` 等；
  - Prisma 风格的 `<prisma|db|tx>.<model>.<count|aggregate|groupBy|create|update|upsert|delete>`；
  - 名字以 `repo` / `repository` 结尾的仓储对象上的 `find` / `findBy` / `count` / `save` / `insert` / `update` / `delete` / `remove` 等；
  - `db` / `pool` / `client` / `connection` / `knex` / `manager` 等连接对象上的 `query` / `execute`，且第一个参数像一条查询（SQL 字符串、名字含 sql/query 的变量、带 `text` / `sql` / `query` 键的对象）；
  - `redis` / `redisClient` 等 Redis 客户端上的单键命令（`mget` / `pipeline` / `multi` 等批量命令除外）；
  - `ruleOptions` 中额外声明的方法名与接收者名。

## 3. 规则说明
- 约束：按数据逐条迭代时，不得在每一轮里单独发起数据访问。
- 判定方式：
  - 先在共享分析索引 `analysis.hotPath.callExpressions` 中找出匹配数据访问形态的调用；没有候选的文件直接跳过。
  - 再确认调用位于“按数据逐条迭代”的作用域内。以下作用域不算：`while` / `do...while`（分页、轮询、重试，每轮一次查询正是预期行为）；条件里不含 `.length` / `.size` 的 `for` 循环（如 `for (let page = 0; page < pages; page++)`）；遍历数组字面量、以数组字面量初始化的 `const`、全大写常量（`ROLES`、`SCHEDULED_RESOURCES`）或其 `Object.keys/values/entries` 的循环——迭代次数固定且很小。外层按数据迭代、内层遍历常量的嵌套写法仍会上报。
  - 参数中已出现批量条件时视为分批查询，不报：对象键 `in` / `$in` / `$all` / `hasSome` / `hasEvery`，调用 `In(...)` / `Any(...)`（TypeORM），或 SQL 字符串中的 `IN (...)` / `ANY(...)`。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项（`ruleOptions`）：
  - `methods`：额外视为数据访问的方法名或函数名，例如 `["getUserById", "fetch"]`；
  - `receivers`：额外视为数据访问客户端的接收者名，其上的任何方法调用都算一次往返，例如 `["api", "userService"]`。
  - HTTP 请求默认不在范围内（逐条请求有时没有批量接口可用）；需要时可把 `fetch`、`axios` 等加入上面两项。

```jsonc
{
  "rules": { "no-n-plus-one-query": "warning" },
  "ruleOptions": {
    "no-n-plus-one-query": {
      "methods": ["getUserById"],
      "receivers": ["api"]
    }
  }
}
```

## 4. 示例
### 4.1 违规示例
```ts
for (const user of users) {
  user.posts = await prisma.post.findMany({ where: { authorId: user.id } })   // 每个用户一次查询
}

await Promise.all(ids.map((id) => UserModel.findById(id)))                    // 并发不减少往返次数

await Promise.all(users.map((u) => pool.query('SELECT * FROM teams WHERE id = $1', [u.teamId])))

for (const user of users) {
  await userRepository.save(user)                                             // 逐条写入
}
```
### 4.2 合规示例
```ts
const posts = await prisma.post.findMany({ where: { authorId: { in: users.map((u) => u.id) } } })
const postsByAuthor = Map.groupBy(posts, (post) => post.authorId)

for (const chunk of chunks) {
  await prisma.user.findMany({ where: { id: { in: chunk } } })                // 分批查询是对 N 很大时的正确修复
}

while (hasMore) {
  const page = await prisma.user.findMany({ skip, take: 100 })               // 分页循环，不报
}

for (const role of ['admin', 'editor']) {
  await Role.findOne({ name: role })                                          // 固定的小集合，不报
}
```

## 5. 例外/豁免
- 规则按 API 形态识别，不做类型推断：自定义的内存仓储若恰好叫 `findOne` / `findById`，或变量名恰好叫 `db` 且其 `query()` 并不访问数据库，也会被报出；可在对应位置关闭本规则。
- 与 `no-await-in-loop` 的关系：`for` 循环里 `await` 一个查询时两条规则可能各报一次。后者建议“并发执行”，但对数据库查询来说真正的修复是本规则建议的“批量查询”。
- 数据库迁移脚本里逐条处理往往是有意为之，可通过 `.autocrignore` 排除迁移目录。

## 6. 与工具的映射
- 规则 ID：`no-n-plus-one-query`
- 规则实现：`packages/auto-cr-rules/src/rules/noNPlusOneQuery.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.124`
- 变更记录：
  - 2.0.124：新增规则，检测热路径中的逐条数据访问（N+1 查询）。

## 8. 参考资料
- Prisma：Query optimization（Solving the n+1 problem）：https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance
- DataLoader：https://github.com/graphql/dataloader
