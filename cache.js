import EventEmitter from "events";
import config from "./config.js";
import { Jsoning, MathOps } from 'jsoning';
import path from "path";

// thanks to https://www.npmjs.com/package/jsoning for the great storage library

// caches the counts of tasks so we know without reaching postgres
class TaskCache extends EventEmitter{
    constructor(data_filepath){
        super();
        this.db = new Jsoning(data_filepath);
    }

    async get(key){
        if(await this.db.has(key)){
            return (await this.db.get(key));
        }else{
            return 0;
        }
    }

    async sync(key, value){
        // for when values are desynced
        await this.db.set(key, value);
        this.emit("change", key);
    }

    async inc(key){
        await this.db.math(key, MathOps.Add, 1);
        this.emit("change", key);
    }

    async dec(key){
        await this.db.math(key, MathOps.Subtract, 1);
        this.emit("change", key);
    }

    async toJSON(){
        return (await this.db.all());
    }

    async keys(){
        return Object.keys(await this.db.all());
    }
}

export const cache = new TaskCache(path.join(config.dataPath, "task_cache.json"));