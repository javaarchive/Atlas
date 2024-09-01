import { Client } from "../client.js";


const client = new Client("http://localhost:3000", "management-cli-" + Date.now(), "default", "management", 1);

(async () => {
    const url = process.argv[2];
    console.log(await client.uploadNewTask({
        key: url,
        data: {
            host: url
        },
        variant: "pptr-headless",
        namespace: "default",
    }));
})();