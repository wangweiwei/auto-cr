async function loadUserProfile(userId: string): Promise<void> {
  try {
    const response = await fetch(`https://api.example.com/users/${userId}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch user profile: ${response.status}`)
    }

    await response.json()
  } catch (error) {
    // ❌ 异常被捕获后既没有抛出也没有记录
    // 真实项目中这类静默吞噬会让诊断问题变得困难
  }
}

export async function runDemo(): Promise<void> {
  await loadUserProfile('123')
}

runDemo()
