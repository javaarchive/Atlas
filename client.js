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
        console.log("Message", message);
        if(message.event.type === "task_suggested"){
            this.tryTask(message.event.task);
        }else if(message.event.type === "heartbeat"){
            this.tick();
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
                "Content-Type": "application/json",
            }
        });
        await this.checkResp(resp);
        return (await resp.json());
    }

    tryTask(task){
        if(this.running < this.concurrency){
            this.completeTaskWrapper(task);
        }
    }

    async completeTaskWrapper(task){
        this.running ++;
        await this.completeTask(task);
        this.running --;
    }
    

    async completeTask(task){
        // not implemented
    }

    async idle(){
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
    }
}
