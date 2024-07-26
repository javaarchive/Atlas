import {Sequelize, DataTypes} from 'sequelize';
import crypto from "crypto";
import normalizeUrl from 'normalize-url';

const sequelize = new Sequelize(process.env.DATABASE_URL || 'sqlite://db.sqlite');


export const Tasks = sequelize.define('tasks', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    url: DataTypes.STRING,
    description: DataTypes.STRING,
    completed: DataTypes.BOOLEAN,
    flags: DataTypes.ARRAY(DataTypes.STRING),
    namespace: DataTypes.STRING,
});

export const Artifacts = sequelize.define('artifacts', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    type: DataTypes.STRING, // likely Content-Type or something less specific
    path: DataTypes.STRING,
    completed: DataTypes.BOOLEAN,
    namespace: DataTypes.STRING,
    task_id: DataTypes.INTEGER,
});

export const Clients = sequelize.define('clients', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    lastHeartbeat: DataTypes.DATE,
    online: DataTypes.BOOLEAN,
    caps: DataTypes.ARRAY(DataTypes.STRING),
});

export function generateID(url){
    return Buffer.from(normalizeUrl(url, {
        stripWWW: true,
        defaultProtocol: "http",
        removeTrailingSlash: true,
        stripAuthentication: true,
        stripHash: true,
        stripTextFragment: true
    })).toString("base64")
}

async function init(hard = false){
    await sequelize.sync({
        alter: hard
    });
}

export {sequelize, init};