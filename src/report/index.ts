import { type NodePath } from '@babel/traverse'
import type {
  AnyTypeAnnotation,
  ArgumentPlaceholder,
  ArrayExpression,
  ArrayPattern,
  ArrayTypeAnnotation,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  AwaitExpression,
  BigIntLiteral,
  BinaryExpression,
  BindExpression,
  BlockStatement,
  BooleanLiteral,
  BooleanLiteralTypeAnnotation,
  BooleanTypeAnnotation,
  BreakStatement,
  CallExpression,
  CatchClause,
  ClassAccessorProperty,
  ClassBody,
  ClassDeclaration,
  ClassExpression,
  ClassImplements,
  ClassMethod,
  ClassPrivateMethod,
  ClassPrivateProperty,
  ClassProperty,
  ConditionalExpression,
  ContinueStatement,
  DebuggerStatement,
  DecimalLiteral,
  DeclareClass,
  DeclaredPredicate,
  DeclareExportAllDeclaration,
  DeclareExportDeclaration,
  DeclareFunction,
  DeclareInterface,
  DeclareModule,
  DeclareModuleExports,
  DeclareOpaqueType,
  DeclareTypeAlias,
  DeclareVariable,
  Decorator,
  Directive,
  DirectiveLiteral,
  DoExpression,
  DoWhileStatement,
  EmptyStatement,
  EmptyTypeAnnotation,
  EnumBooleanBody,
  EnumBooleanMember,
  EnumDeclaration,
  EnumDefaultedMember,
  EnumNumberBody,
  EnumNumberMember,
  EnumStringBody,
  EnumStringMember,
  EnumSymbolBody,
  ExistsTypeAnnotation,
  ExportAllDeclaration,
  ExportDefaultDeclaration,
  ExportDefaultSpecifier,
  ExportNamedDeclaration,
  ExportNamespaceSpecifier,
  ExportSpecifier,
  ExpressionStatement,
  File,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  FunctionTypeAnnotation,
  FunctionTypeParam,
  GenericTypeAnnotation,
  Identifier,
  IfStatement,
  Import,
  ImportAttribute,
  ImportDeclaration,
  ImportDefaultSpecifier,
  ImportExpression,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  IndexedAccessType,
  InferredPredicate,
  InterfaceDeclaration,
  InterfaceExtends,
  InterfaceTypeAnnotation,
  InterpreterDirective,
  IntersectionTypeAnnotation,
  JSXAttribute,
  JSXClosingElement,
  JSXClosingFragment,
  JSXElement,
  JSXEmptyExpression,
  JSXExpressionContainer,
  JSXFragment,
  JSXIdentifier,
  JSXMemberExpression,
  JSXNamespacedName,
  JSXOpeningElement,
  JSXOpeningFragment,
  JSXSpreadAttribute,
  JSXSpreadChild,
  JSXText,
  LabeledStatement,
  LogicalExpression,
  MemberExpression,
  MetaProperty,
  MixedTypeAnnotation,
  ModuleExpression,
  NewExpression,
  Noop,
  NullableTypeAnnotation,
  NullLiteral,
  NullLiteralTypeAnnotation,
  NumberLiteralTypeAnnotation,
  NumberTypeAnnotation,
  NumericLiteral,
  ObjectExpression,
  ObjectMethod,
  ObjectPattern,
  ObjectProperty,
  ObjectTypeAnnotation,
  ObjectTypeCallProperty,
  ObjectTypeIndexer,
  ObjectTypeInternalSlot,
  ObjectTypeProperty,
  ObjectTypeSpreadProperty,
  OpaqueType,
  OptionalCallExpression,
  OptionalIndexedAccessType,
  OptionalMemberExpression,
  ParenthesizedExpression,
  PipelineBareFunction,
  PipelinePrimaryTopicReference,
  PipelineTopicExpression,
  Placeholder,
  PrivateName,
  Program,
  QualifiedTypeIdentifier,
  RecordExpression,
  RegExpLiteral,
  RestElement,
  ReturnStatement,
  SequenceExpression,
  SpreadElement,
  StaticBlock,
  StringLiteral,
  StringLiteralTypeAnnotation,
  StringTypeAnnotation,
  Super,
  SwitchCase,
  SwitchStatement,
  SymbolTypeAnnotation,
  TaggedTemplateExpression,
  TemplateElement,
  TemplateLiteral,
  ThisExpression,
  ThisTypeAnnotation,
  ThrowStatement,
  TopicReference,
  TryStatement,
  TSAnyKeyword,
  TSArrayType,
  TSAsExpression,
  TSBigIntKeyword,
  TSBooleanKeyword,
  TSCallSignatureDeclaration,
  TSConditionalType,
  TSConstructorType,
  TSConstructSignatureDeclaration,
  TSDeclareFunction,
  TSDeclareMethod,
  TSEnumBody,
  TSEnumDeclaration,
  TSEnumMember,
  TSExportAssignment,
  TSExpressionWithTypeArguments,
  TSExternalModuleReference,
  TSFunctionType,
  TSImportEqualsDeclaration,
  TSImportType,
  TSIndexedAccessType,
  TSIndexSignature,
  TSInferType,
  TSInstantiationExpression,
  TSInterfaceBody,
  TSInterfaceDeclaration,
  TSIntersectionType,
  TSIntrinsicKeyword,
  TSLiteralType,
  TSMappedType,
  TSMethodSignature,
  TSModuleBlock,
  TSModuleDeclaration,
  TSNamedTupleMember,
  TSNamespaceExportDeclaration,
  TSNeverKeyword,
  TSNonNullExpression,
  TSNullKeyword,
  TSNumberKeyword,
  TSObjectKeyword,
  TSOptionalType,
  TSParameterProperty,
  TSParenthesizedType,
  TSPropertySignature,
  TSQualifiedName,
  TSRestType,
  TSSatisfiesExpression,
  TSStringKeyword,
  TSSymbolKeyword,
  TSTemplateLiteralType,
  TSThisType,
  TSTupleType,
  TSTypeAliasDeclaration,
  TSTypeAnnotation,
  TSTypeAssertion,
  TSTypeLiteral,
  TSTypeOperator,
  TSTypeParameter,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
  TSTypePredicate,
  TSTypeQuery,
  TSTypeReference,
  TSUndefinedKeyword,
  TSUnionType,
  TSUnknownKeyword,
  TSVoidKeyword,
  TupleExpression,
  TupleTypeAnnotation,
  TypeAlias,
  TypeAnnotation,
  TypeCastExpression,
  TypeofTypeAnnotation,
  TypeParameter,
  TypeParameterDeclaration,
  TypeParameterInstantiation,
  UnaryExpression,
  UnionTypeAnnotation,
  UpdateExpression,
  V8IntrinsicIdentifier,
  VariableDeclaration,
  VariableDeclarator,
  Variance,
  VoidPattern,
  VoidTypeAnnotation,
  WhileStatement,
  WithStatement,
  YieldExpression,
} from '@babel/types'

type Node =
  | AnyTypeAnnotation
  | ArgumentPlaceholder
  | ArrayExpression
  | ArrayPattern
  | ArrayTypeAnnotation
  | ArrowFunctionExpression
  | AssignmentExpression
  | AssignmentPattern
  | AwaitExpression
  | BigIntLiteral
  | BinaryExpression
  | BindExpression
  | BlockStatement
  | BooleanLiteral
  | BooleanLiteralTypeAnnotation
  | BooleanTypeAnnotation
  | BreakStatement
  | CallExpression
  | CatchClause
  | ClassAccessorProperty
  | ClassBody
  | ClassDeclaration
  | ClassExpression
  | ClassImplements
  | ClassMethod
  | ClassPrivateMethod
  | ClassPrivateProperty
  | ClassProperty
  | ConditionalExpression
  | ContinueStatement
  | DebuggerStatement
  | DecimalLiteral
  | DeclareClass
  | DeclareExportAllDeclaration
  | DeclareExportDeclaration
  | DeclareFunction
  | DeclareInterface
  | DeclareModule
  | DeclareModuleExports
  | DeclareOpaqueType
  | DeclareTypeAlias
  | DeclareVariable
  | DeclaredPredicate
  | Decorator
  | Directive
  | DirectiveLiteral
  | DoExpression
  | DoWhileStatement
  | EmptyStatement
  | EmptyTypeAnnotation
  | EnumBooleanBody
  | EnumBooleanMember
  | EnumDeclaration
  | EnumDefaultedMember
  | EnumNumberBody
  | EnumNumberMember
  | EnumStringBody
  | EnumStringMember
  | EnumSymbolBody
  | ExistsTypeAnnotation
  | ExportAllDeclaration
  | ExportDefaultDeclaration
  | ExportDefaultSpecifier
  | ExportNamedDeclaration
  | ExportNamespaceSpecifier
  | ExportSpecifier
  | ExpressionStatement
  | File
  | ForInStatement
  | ForOfStatement
  | ForStatement
  | FunctionDeclaration
  | FunctionExpression
  | FunctionTypeAnnotation
  | FunctionTypeParam
  | GenericTypeAnnotation
  | Identifier
  | IfStatement
  | Import
  | ImportAttribute
  | ImportDeclaration
  | ImportDefaultSpecifier
  | ImportExpression
  | ImportNamespaceSpecifier
  | ImportSpecifier
  | IndexedAccessType
  | InferredPredicate
  | InterfaceDeclaration
  | InterfaceExtends
  | InterfaceTypeAnnotation
  | InterpreterDirective
  | IntersectionTypeAnnotation
  | JSXAttribute
  | JSXClosingElement
  | JSXClosingFragment
  | JSXElement
  | JSXEmptyExpression
  | JSXExpressionContainer
  | JSXFragment
  | JSXIdentifier
  | JSXMemberExpression
  | JSXNamespacedName
  | JSXOpeningElement
  | JSXOpeningFragment
  | JSXSpreadAttribute
  | JSXSpreadChild
  | JSXText
  | LabeledStatement
  | LogicalExpression
  | MemberExpression
  | MetaProperty
  | MixedTypeAnnotation
  | ModuleExpression
  | NewExpression
  | Noop
  | NullLiteral
  | NullLiteralTypeAnnotation
  | NullableTypeAnnotation
  | NumberLiteralTypeAnnotation
  | NumberTypeAnnotation
  | NumericLiteral
  | ObjectExpression
  | ObjectMethod
  | ObjectPattern
  | ObjectProperty
  | ObjectTypeAnnotation
  | ObjectTypeCallProperty
  | ObjectTypeIndexer
  | ObjectTypeInternalSlot
  | ObjectTypeProperty
  | ObjectTypeSpreadProperty
  | OpaqueType
  | OptionalCallExpression
  | OptionalIndexedAccessType
  | OptionalMemberExpression
  | ParenthesizedExpression
  | PipelineBareFunction
  | PipelinePrimaryTopicReference
  | PipelineTopicExpression
  | Placeholder
  | PrivateName
  | Program
  | QualifiedTypeIdentifier
  | RecordExpression
  | RegExpLiteral
  | RestElement
  | ReturnStatement
  | SequenceExpression
  | SpreadElement
  | StaticBlock
  | StringLiteral
  | StringLiteralTypeAnnotation
  | StringTypeAnnotation
  | Super
  | SwitchCase
  | SwitchStatement
  | SymbolTypeAnnotation
  | TSAnyKeyword
  | TSArrayType
  | TSAsExpression
  | TSBigIntKeyword
  | TSBooleanKeyword
  | TSCallSignatureDeclaration
  | TSConditionalType
  | TSConstructSignatureDeclaration
  | TSConstructorType
  | TSDeclareFunction
  | TSDeclareMethod
  | TSEnumBody
  | TSEnumDeclaration
  | TSEnumMember
  | TSExportAssignment
  | TSExpressionWithTypeArguments
  | TSExternalModuleReference
  | TSFunctionType
  | TSImportEqualsDeclaration
  | TSImportType
  | TSIndexSignature
  | TSIndexedAccessType
  | TSInferType
  | TSInstantiationExpression
  | TSInterfaceBody
  | TSInterfaceDeclaration
  | TSIntersectionType
  | TSIntrinsicKeyword
  | TSLiteralType
  | TSMappedType
  | TSMethodSignature
  | TSModuleBlock
  | TSModuleDeclaration
  | TSNamedTupleMember
  | TSNamespaceExportDeclaration
  | TSNeverKeyword
  | TSNonNullExpression
  | TSNullKeyword
  | TSNumberKeyword
  | TSObjectKeyword
  | TSOptionalType
  | TSParameterProperty
  | TSParenthesizedType
  | TSPropertySignature
  | TSQualifiedName
  | TSRestType
  | TSSatisfiesExpression
  | TSStringKeyword
  | TSSymbolKeyword
  | TSTemplateLiteralType
  | TSThisType
  | TSTupleType
  | TSTypeAliasDeclaration
  | TSTypeAnnotation
  | TSTypeAssertion
  | TSTypeLiteral
  | TSTypeOperator
  | TSTypeParameter
  | TSTypeParameterDeclaration
  | TSTypeParameterInstantiation
  | TSTypePredicate
  | TSTypeQuery
  | TSTypeReference
  | TSUndefinedKeyword
  | TSUnionType
  | TSUnknownKeyword
  | TSVoidKeyword
  | TaggedTemplateExpression
  | TemplateElement
  | TemplateLiteral
  | ThisExpression
  | ThisTypeAnnotation
  | ThrowStatement
  | TopicReference
  | TryStatement
  | TupleExpression
  | TupleTypeAnnotation
  | TypeAlias
  | TypeAnnotation
  | TypeCastExpression
  | TypeParameter
  | TypeParameterDeclaration
  | TypeParameterInstantiation
  | TypeofTypeAnnotation
  | UnaryExpression
  | UnionTypeAnnotation
  | UpdateExpression
  | V8IntrinsicIdentifier
  | VariableDeclaration
  | VariableDeclarator
  | Variance
  | VoidPattern
  | VoidTypeAnnotation
  | WhileStatement
  | WithStatement
  | YieldExpression

type ReportFunction = <T extends Node>(issue: NodePath<T>, message: string) => void
export const report: ReportFunction = <T extends Node>(issue: NodePath<T>, message: string) => {
  const lineNumber = issue?.node?.loc?.start?.line
  console.log(`[ERROR] Line ${lineNumber}: ${message}`)
}
