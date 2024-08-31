import {Sequelize, DataTypes} from 'sequelize';
import crypto from "crypto";
import normalizeUrl from 'normalize-url';
import config from '../config.js';

const sequelize = new Sequelize(config.databaseURL);

import { cache } from './cache.js';

export const Tasks = sequelize.define('tasks', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    key: DataTypes.STRING, // should be unique
    data: DataTypes.JSON,
    description: DataTypes.STRING,
    completed: DataTypes.BOOLEAN,
    variant: DataTypes.STRING,
    namespace: DataTypes.STRING,
    completerID: DataTypes.STRING,
    startTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    refererID: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});

export const Artifacts = sequelize.define('artifacts', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    type: {
        type: DataTypes.STRING, // likely Content-Type or something less specific
        defaultValue: "application/octet-stream"
    },
    path: DataTypes.STRING,
    completed: DataTypes.BOOLEAN,
    namespace: DataTypes.STRING,
    task_id: DataTypes.INTEGER,
    name: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

export const Clients = sequelize.define('clients', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    lastHeartbeat: DataTypes.DATE,
    online: DataTypes.BOOLEAN,
    variant: DataTypes.STRING,
    namespace : DataTypes.STRING
});

export const Policy = sequelize.define('policy', {
    id: {
        // sha256 of namespace + hostname
        type: DataTypes.STRING,
        primaryKey: true
    },
    namespace: DataTypes.STRING,
    hostname: DataTypes.STRING,
    rules: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    robots: {
        type: DataTypes.BLOB,
        allowNull: true
    }
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

async function resyncCounts(variant, namespace = config.defaultNamespace){
    await cache.sync(variant, await Tasks.count({
        where: {
            namespace: namespace,
            variant: variant
        }
    }));
}

async function resyncKnown(namespace = config.defaultNamespace){
    let keys = await cache.keys();
    for(let key of keys){
        await resyncCounts(key, namespace);
    }
}

// TODO: resync all counts func

export {sequelize, init, resyncCounts, resyncKnown};