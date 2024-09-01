import fetch from "node-fetch";

import EventSource from "eventsource"

import http from "http";
import https from "https";

// https://github.com/node-fetch/node-fetch?tab=readme-ov-file#custom-agent
// http/https agent setup
const agents = {
    http: new http.Agent({
        keepAlive: true
    }),
    https: new https.Agent({
        keepAlive: true
    })
}

const defaultFetchOptions = {
    agent: (_parsedURL) => {
        if (_parsedURL.protocol == 'http:') {
			return agents.http;
		} else {
			return agents.https;
		}
    },
    headers: {
        "User-Agent": "AtlasNodeClient/1.0"
    }
}

export class Client {

    /**
     * @type {string}
     *
     * @memberof Client
     */
    baseURL;

    constructor(url, clientID, namespace = "default", variant = "default", concurrency = 1){
        this.baseURL = url;
        this.namespace = namespace;
        this.clientID = clientID;
        this.onMessageBound = this.onMessage.bind(this);
        this.concurrency = concurrency;
        this.running = 0;
        this.variant = variant;
        this.logging = false;
        this.taskCountCache = 0;
    }

    async sync(){
        let resp = await fetch(`${this.baseURL}/api/clients/sync`, {
            ...defaultFetchOptions,
            method: "POST",
            headers: {
                ...defaultFetchOptions.headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                id: this.clientID,
                namespace: this.namespace,
                variant: this.variant,
                online: true,
                // extras we like to report
                concurrency: this.concurrency,
                running: this.running
            })
        });
        await this.checkResp(resp);
    }

    async connect(){
        await this.sync();
        console.log("Initial sync complete.");
        this.source = new EventSource(`${this.baseURL}/api/events/${this.clientID}`);
        this.source.addEventListener("message", this.onMessageBound);
        this.source.addEventListener("error", console.warn);
    }

    disconnect(){
        this.source.removeEventListener("message", this.onMessageBound);
        this.source.close();
    }

    /**
     *
     * @param {MessageEvent} event
     * @memberof Client
     */
    onMessage(event){
        // hopefully a string
        const message = JSON.parse(event.data);
        if(this.logging) console.log("Message", message);
        if(message.event.type === "task_suggested"){
            this.tryTask(message.event.task).then(success => {
                if(success) {
                    this.requestTask();
                }
            })
        }else if(message.event.type === "heartbeat"){
            this.tick();
        }else if(message.event.type === "sync_cache_count"){
            if(message.event.cache[this.variant]){
                this.taskCountCache = message.event.cache[this.variant];
            }
        }else if(message.event.type === "sync_cache_count_sub"){
            if(message.event.variant == this.variant){
                this.taskCountCache = message.event.value;
            }
        }
    }

    async getNewTask(){
        let resp = await fetch(`${this.baseURL}/api/tasks/acquire`, {
            ...defaultFetchOptions,
            method: "POST",
            headers: {
                ...defaultFetchOptions.headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                clientID: this.clientID,
                namespace: this.namespace,
                variant: this.variant
            })
        });
        await this.checkResp(resp);
        return (await resp.json());
    }

    async uploadNewTask(task){
        let resp = await fetch(`${this.baseURL}/api/tasks/create`, {
            ...defaultFetchOptions,
            method: "POST",
            headers: {
                ...defaultFetchOptions.headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(task)
        });
        await this.checkResp(resp);
        return (await resp.json());
    }

    async requestRobots(host){
        return (await this.uploadNewTask({
            key: host,
            data: {
                host: host
            },
            variant: "robots",
            namespace: this.namespace,
        }));
    }

    async checkRobots(url, userAgent){
        let urlObj = new URL(url);
        let host = urlObj.host;
        let resp = await fetch(`${this.baseURL}/api/robots/check/${host}?url=${encodeURIComponent(url)}`, {
            ...defaultFetchOptions,
            method: "GET",
            headers: {
                ...defaultFetchOptions.headers,
                "User-Agent": userAgent,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                clientID: this.clientID,
                namespace: this.namespace,
                variant: this.variant,
                url: url
            })
        });
        if(resp.status == 200){
            await this.checkResp(resp);
            return (await resp.json())["data"]["allowed"];
        }else if(resp.status == 404){
            return null;
        }
    }

    // use this because it sends it through our event stream
    async requestTask(){
        let resp = await fetch(`${this.baseURL}/api/tasks/pull`, {
            ...defaultFetchOptions,
            method: "POST",
            headers: {
                ...defaultFetchOptions.headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                clientID: this.clientID,
                namespace: this.namespace,
                variant: this.variant,
                repeat: this.concurrency - this.running
            })
        });
        await this.checkResp(resp);
        return (await resp.json());
    }

    tick(){
        if(this.running < this.concurrency){
            this.requestTask();
        } else if(this.running == 0){
            this.idle();
        }
    }

    async checkResp(resp){
        if(!resp.ok){
            throw new Error(resp.statusText + " code: " + resp.status + " " + (await resp.text()));
        }
    }

    async getJob(id){
        let resp = await fetch(`${this.baseURL}/api/tasks/get/${id}`, {
            ...defaultFetchOptions,
            method: "GET",
            headers: {
                ...defaultFetchOptions.headers,
            }
        });
        await this.checkResp(resp);
        return (await resp.json())["data"];
    }

    async getServerCache(){
        let resp = await fetch(`${this.baseURL}/api/cache_count`, {
            ...defaultFetchOptions,
            method: "GET",
            headers: {
                ...defaultFetchOptions.headers,
            }
        });
        await this.checkResp(resp);
        return (await resp.json())["data"];
    }

    async getServerCacheCountForVariant(variant){
        let resp = await fetch(`${this.baseURL}/api/cache_count/${variant}`, {
            ...defaultFetchOptions,
            method: "GET",
            headers: {
                ...defaultFetchOptions.headers,
            }
        });
        await this.checkResp(resp);
        return (await resp.json())["data"];
    }

    async syncServerCacheCount(){
        let count = await this.getServerCacheCountForVariant(this.variant);
        this.taskCountCache = count;
    }

    async tryTask(task){
        if(this.running < this.concurrency){
            await this.completeTaskWrapper(task);
            return true;
        }else{
            return false;
        }
    }

    async completeTaskWrapper(task){
        this.running ++;
        if(this.logging) {
            console.log("Start task", task);
        }
        await this.completeTask(task);
        if(this.logging) {
            console.log("Completed task", task);
        }
        this.running --;
    }
    

    async completeTask(task){
        // not implemented, implement by subclass
    }

    async fillTasks(){
        let resp = await fetch(`${this.baseURL}/api/tasks/pull`, {
            ...defaultFetchOptions,
            method: "POST",
            headers: {
                ...defaultFetchOptions.headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                clientID: this.clientID,
                namespace: this.namespace,
                variant: this.variant,
                repeat: this.concurrency - this.running
            })
        });

        try{
            await this.checkResp(resp);
            let data = (await resp.json()).data;
            for(let task of data.data){
                this.tryTask(task);
            }
        }catch(ex){
            
        }
    }

    async idle(){
        await this.syncServerCacheCount();
        if(this.taskCountCache > 0){
            await this.fillTasks();
        }
    }
}
