
import { execFile } from "child_process";
import { FastifyReply, FastifyRequest } from "fastify";
import fs from "fs";
import { ServerResponse } from "http";
import path from "path";
import { getDBConnection } from ".";
import { ReqInitialize } from "./types";

export async function getIndex(_req: any, reply: FastifyReply<ServerResponse>) {
    const html = await fs.promises.readFile(
        path.join(__dirname, "public/index.html")
    );
    reply.type("text/html").send(html);
}

export async function postInitialize(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const ri: ReqInitialize = req.body;

    await execFile("../sql/init.sh");

    const db = await getDBConnection();

    await db.query(
        "INSERT INTO `configs` (`name`, `val`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `val` = VALUES(`val`)",
        ["payment_service_url", ri.payment_service_url]
    );

    await db.query(
        "INSERT INTO `configs` (`name`, `val`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `val` = VALUES(`val`)",
        ["shipment_service_url", ri.shipment_service_url]
    );

    const res = {
        // キャンペーン実施時には還元率の設定を返す。詳しくはマニュアルを参照のこと。
        campaign: 0,
        // 実装言語を返す
        language: "nodejs",
    };

    await db.release();

    reply
        .code(200)
        .type("application/json")
        .send(res);
}



export function getSession(req: FastifyRequest) {
}

export function replyError(reply: FastifyReply<ServerResponse>, message: string, status = 500) {
    reply.code(status)
        .type("application/json")
        .send({ "error": message });
}