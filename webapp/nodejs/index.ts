import bcrypt from 'bcrypt';
import childProcess from "child_process";
import createFastify, { FastifyRequest } from "fastify";
import fastifyCookie from "fastify-cookie";
import fastifyMultipart from 'fastify-multipart';
// @ts-ignore
import fastifyMysql from "fastify-mysql";
import fastifyStatic from "fastify-static";
import { IncomingMessage } from "http";
import path from "path";
import TraceError from "trace-error";
import util from "util";
import { getItem, getNewCategoryItems, getNewItems, getQRCode, getReports, getSettings, getTransactions, getUserItems } from "./get";
import { getIndex, postInitialize } from './initial';
import { postBump, postBuy, postComplete, postItemEdit, postLogin, postRegister, postSell, postShip, postShipDone } from "./post";
import { MySQLClient, MySQLQueryable } from "./types";

export const execFile = util.promisify(childProcess.execFile);

declare module "fastify" {
    interface FastifyInstance<HttpServer, HttpRequest, HttpResponse> {
        mysql: MySQLQueryable & {
            getConnection(): Promise<MySQLClient>;
        };
    }

    interface FastifyRequest<HttpRequest> {
        // add types if needed
    }

    interface FastifyReply<HttpResponse> {
        // add types if needed
    }
}


export const fastify = createFastify({
    logger: { level: 'warn' }
});

fastify.register(fastifyStatic, {
    root: path.join(__dirname, "public")
});

fastify.register(fastifyCookie);

fastify.register(fastifyMultipart, {
    addToBody: true,
});

fastify.register(fastifyMysql, {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: process.env.MYSQL_PORT || "3306",
    user: process.env.MYSQL_USER || "isucari",
    password: process.env.MYSQL_PASS || "isucari",
    database: process.env.MYSQL_DBNAME || "isucari",
    pool: 100,

    promise: true
});

export function buildUriFor<T extends IncomingMessage>(request: FastifyRequest<T>) {
    const uriBase = `http://${request.headers.host}`;
    return (path: string) => {
        return `${uriBase}${path}`;
    };
}

export async function getDBConnection() {
    return fastify.mysql.getConnection();
}

// API

fastify.post("/initialize", postInitialize);

// users
fastify.get("/users/transactions.json", getTransactions);
fastify.get("/users/:user_id(^\\d+).json", getUserItems);

// items
fastify.get("/items/:item_id(^\\d+).json", getItem);
fastify.post("/items/edit", postItemEdit);
fastify.get("/new_items.json", getNewItems);
fastify.get("/new_items/:root_category_id(^\\d+).json", getNewCategoryItems);

// payment
fastify.post("/buy", postBuy);
fastify.post("/sell", postSell);
fastify.post("/ship", postShip)
fastify.post("/ship_done", postShipDone);
fastify.post("/complete", postComplete);
fastify.get("/transactions/:transaction_evidence_id(^\\d+).png", getQRCode);

// 
fastify.post("/bump", postBump);
fastify.get("/settings", getSettings);

// login
fastify.post("/login", postLogin);
fastify.post("/register", postRegister);

// misc
fastify.get("/reports.json", getReports);

// Frontend
fastify.get("/", getIndex);
fastify.get("/login", getIndex);
fastify.get("/register", getIndex);
fastify.get("/timeline", getIndex);
fastify.get("/categories/:category_id/items", getIndex);
fastify.get("/sell", getIndex);
fastify.get("/items/:item_id", getIndex);
fastify.get("/items/:item_id/edit", getIndex);
fastify.get("/items/:item_id/buy", getIndex);
fastify.get("/buy/complete", getIndex);
fastify.get("/transactions/:transaction_id", getIndex);
fastify.get("/users/:user_id", getIndex);
fastify.get("/users/setting", getIndex);


fastify.listen(8000, (err, _address) => {
    if (err) {
        throw new TraceError("Failed to listening", err);
    }
});

export async function encryptPassword(password: string): Promise<string> {
    return await new Promise((resolve) => {
        bcrypt.hash(password, 10, (err, hash) => {
            if (err != null) {
                throw err;
            }
            resolve(hash);
        });
    })
}

export async function comparePassword(inputPassword: string, hashedPassword: string): Promise<boolean> {
    return await new Promise((resolve) => {
        bcrypt.compare(inputPassword, hashedPassword.toString(), (err, isValid) => {
            resolve(isValid);
        });
    });
}

