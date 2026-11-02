import { drizzle } from 'drizzle-orm/expo-sqlite'
import { bundledExtensions, openDatabaseSync } from 'expo-sqlite'

import { openEncryptedDatabase } from './encryption'
import * as schema from './schema'

export const DB_NAME = 'db.db'

export const sqliteDB = openEncryptedDatabase(DB_NAME, (name) =>
    openDatabaseSync(name, { enableChangeListener: true })
)
const extension = bundledExtensions['sqlite-vec']
if (extension) sqliteDB.loadExtensionAsync(extension?.libPath, extension?.entryPoint)
export const db = drizzle(sqliteDB, { schema })

export type TableNames = {
    [K in keyof typeof schema]: (typeof schema)[K] extends { _: { name: infer TName } }
        ? TName & string
        : never
}[keyof typeof schema]

sqliteDB.execSync('PRAGMA foreign_keys = ON;')
