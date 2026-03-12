declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: unknown[]): Database
    exec(sql: string, params?: unknown[]): QueryExecResult[]
    prepare(sql: string): Statement
    close(): void
    getRowsModified(): number
    export(): Uint8Array
  }

  interface Statement {
    bind(params?: unknown[]): boolean
    step(): boolean
    getAsObject(params?: Record<string, unknown>): Record<string, unknown>
    get(params?: unknown[]): unknown[]
    free(): boolean
    reset(): void
    run(params?: unknown[]): void
  }

  interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  interface InitSqlJsOptions {
    locateFile?: (filename: string) => string
  }

  export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>
  export type { Database, Statement, QueryExecResult, SqlJsStatic }
}
