export const config = {
    port: process.env.PORT || 3000,
    secret: process.env.SECRET || "secret",
    defaultNamespace: process.env.DEFAULT_NAMESPACE || "default",
    databaseURL: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/atlas",
    dataPath: process.env.DATA_PATH || "data",
}

export default config;