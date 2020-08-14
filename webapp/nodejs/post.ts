import { FastifyReply, FastifyRequest } from "fastify";
import fs from "fs";
import { ServerResponse } from "http";
import path from "path";
import { comparePassword, encryptPassword, getDBConnection } from ".";
import { paymentToken, shipmentCreate, shipmentRequest, shipmentStatus } from "./api";
import { BumpChargeSeconds, ItemMaxPrice, ItemMinPrice, ItemPriceErrMsg, ItemStatusOnSale, ItemStatusSoldOut, ItemStatusTrading, PaymentServiceIsucariAPIKey, PaymentServiceIsucariShopID, ShippingsStatusDone, ShippingsStatusInitial, ShippingsStatusShipping, ShippingsStatusWaitPickup, TransactionEvidenceStatusDone, TransactionEvidenceStatusWaitDone, TransactionEvidenceStatusWaitShipping } from "./constants";
import { getCategoryByID, getLoginUser, getPaymentServiceURL, getRandomString, getShipmentServiceURL } from "./get";
import { replyError } from "./initial";
import { Item, ReqLogin, ReqRegister, Shipping, TransactionEvidence, User } from "./types";

export async function postItemEdit(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const csrfToken = req.body.csrf_token;
    const itemID = req.body.item_id;
    const price = req.body.item_price;

    if (csrfToken !== req.cookies.csrf_token) {
        replyError(reply, "csrf token error", 422)
        return;
    }

    if (price < ItemMinPrice || price > ItemMaxPrice) {
        replyError(reply, ItemPriceErrMsg, 400);
        return;
    }

    const db = await getDBConnection();

    const seller = await getLoginUser(req, db);
    if (seller === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }

    let targetItem: Item | null = null;
    ;
    {
        const [rows] = await db.query("SELECT * FROM `items` WHERE `id` = ?", [itemID]);
        for (const row of rows) {
            targetItem = row as Item;
        }
    }

    if (targetItem === null) {
        replyError(reply, "item not found");
        await db.release();
        return;
    }

    if (targetItem.seller_id !== seller.id) {
        replyError(reply, "自分の商品以外は編集できません", 403);
        await db.release();
        return;
    }

    await db.beginTransaction();

    await db.query("SELECT * FROM `items` WHERE `id` = ? FOR UPDATE", [targetItem.id]);

    if (targetItem.status !== ItemStatusOnSale) {
        replyError(reply, "販売中の商品以外編集できません", 403);
        await db.rollback();
        return;
    }

    await db.query("UPDATE `items` SET `price` = ?, `updated_at` = ? WHERE `id` = ?", [price, new Date(), targetItem.id]);

    {
        const [rows] = await db.query("SELECT * FROM `items` WHERE `id` = ?", [targetItem.id]);
        for (const row of rows) {
            targetItem = row as Item;
        }
    }

    await db.commit();
    await db.release();

    reply
        .code(200)
        .type("application/json;charset=utf-8")
        .send({
            item_id: targetItem.id,
            item_price: targetItem.price,
            item_created_at: targetItem.created_at.getTime(),
            item_updated_at: targetItem.updated_at.getTime(),
        })


}

export async function postBuy(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const csrfToken = req.body.csrf_token;

    if (csrfToken !== req.cookies.csrf_token) {
        replyError(reply, "csrf token error", 422);
        return;
    }

    const db = await getDBConnection();

    const buyer = await getLoginUser(req, db);

    if (buyer === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }

    await db.beginTransaction();

    let targetItem: Item | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `items` WHERE `id` = ? FOR UPDATE", [req.body.item_id]);

        for (const row of rows) {
            targetItem = row as Item;
        }
    }

    if (targetItem === null) {
        replyError(reply, "item not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    if (targetItem.status !== ItemStatusOnSale) {
        replyError(reply, "item is not for sale", 403);
        await db.rollback();
        await db.release();
        return;
    }

    if (targetItem.seller_id === buyer.id) {
        replyError(reply, "自分の商品は買えません", 403);
        await db.rollback();
        await db.release();
        return;
    }

    let seller: User | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `users` WHERE `id` = ? FOR UPDATE", [targetItem.seller_id]);
        for (const row of rows) {
            seller = row as User;
        }
    }

    if (seller === null) {
        replyError(reply, "seller not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    const category = await getCategoryByID(db, targetItem.category_id);
    if (category === null) {
        replyError(reply, "category id error", 500);
        await db.rollback();
        await db.release();
        return;
    }

    const [result] = await db.query(
        "INSERT INTO `transaction_evidences` (`seller_id`, `buyer_id`, `status`, `item_id`, `item_name`, `item_price`, `item_description`,`item_category_id`,`item_root_category_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            targetItem.seller_id,
            buyer.id,
            TransactionEvidenceStatusWaitShipping,
            targetItem.id,
            targetItem.name,
            targetItem.price,
            targetItem.description,
            category.id,
            category.parent_id,
        ]
    );

    const transactionEvidenceId = result.insertId;

    await db.query(
        "UPDATE `items` SET `buyer_id` = ?, `status` = ?, `updated_at` = ? WHERE `id` = ?",
        [
            buyer.id,
            ItemStatusTrading,
            new Date(),
            targetItem.id,
        ]
    )

    try {
        const scr = await shipmentCreate(await getShipmentServiceURL(db), {
            to_address: buyer.address,
            to_name: buyer.account_name,
            from_address: seller.address,
            from_name: seller.account_name,
        });

        try {
            const pstr = await paymentToken(await getPaymentServiceURL(db), {
                shop_id: PaymentServiceIsucariShopID.toString(),
                token: req.body.token,
                api_key: PaymentServiceIsucariAPIKey,
                price: targetItem.price,
            });

            if (pstr.status === "invalid") {
                replyError(reply, "カード情報に誤りがあります", 400);
                await db.rollback();
                await db.release();
                return;
            }
            if (pstr.status === "fail") {
                replyError(reply, "カードの残高が足りません", 400);
                await db.rollback();
                await db.release();
                return;
            }

            if (pstr.status !== 'ok') {
                replyError(reply, "想定外のエラー", 400)
                await db.rollback()
                await db.release();
                return;
            }

            await db.query(
                "INSERT INTO `shippings` (`transaction_evidence_id`, `status`, `item_name`, `item_id`, `reserve_id`, `reserve_time`, `to_address`, `to_name`, `from_address`, `from_name`, `img_binary`) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                [
                    transactionEvidenceId,
                    ShippingsStatusInitial,
                    targetItem.name,
                    targetItem.id,
                    scr.reserve_id,
                    scr.reserve_time,
                    buyer.address,
                    buyer.account_name,
                    seller.address,
                    seller.account_name,
                    "",
                ]
            );
        } catch (e) {
            replyError(reply, "payment service is failed", 500)
            await db.rollback();
            await db.release();
            return;
        }
    } catch (error) {
        replyError(reply, "failed to request to shipment service", 500);
        await db.rollback();
        await db.release();
        return;
    }

    await db.commit();
    await db.release();

    reply.code(200)
        .type("application/json;charset=utf-8")
        .send({
            transaction_evidence_id: transactionEvidenceId,
        });

}

export async function postSell(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const csrfToken = req.body.csrf_token;
    const name = req.body.name;
    const description = req.body.description;
    const priceStr = req.body.price;
    const categoryIdStr = req.body.category_id;

    if (csrfToken !== req.cookies.csrf_token) {
        replyError(reply, "csrf token error", 422);
        return;
    }

    const categoryId: number = parseInt(categoryIdStr, 10);
    if (isNaN(categoryId) || categoryId < 0) {
        replyError(reply, "category id error", 400);
        return;
    }

    const price: number = parseInt(priceStr, 10);
    if (isNaN(price) || price < 0) {
        replyError(reply, "price error", 400);
        return;
    }

    if (price < ItemMinPrice || price > ItemMaxPrice) {
        replyError(reply, ItemPriceErrMsg, 400);
        return;
    }

    if (name === null || name === "" || description === null || description === "" || price === 0 || categoryId === 0) {
        replyError(reply, "all parameters are required", 400);
    }

    const db = await getDBConnection();

    const category = await getCategoryByID(db, categoryId);
    if (category === null || category.parent_id === 0) {
        replyError(reply, "Incorrect category ID", 400);
        await db.release();
        return;
    }

    const user = await getLoginUser(req, db);

    if (user === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }

    let ext = path.extname(req.body.image[0].filename);
    if (![".jpg", ".jpeg", ".png", ".gif"].includes(ext)) {
        replyError(reply, "unsupported image format error", 400);
        await db.release();
        return;
    }

    if (ext === ".jpeg") {
        ext = ".jpg";
    }


    const imgName = `${await getRandomString(16)}${ext}`;

    await fs.promises.writeFile(`../public/upload/${imgName}`, req.body.image[0].data);

    await db.beginTransaction();

    let seller: User | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `users` WHERE `id` = ? FOR UPDATE", [user.id]);
        for (const row of rows) {
            seller = row as User;
        }
    }

    if (seller === null) {
        replyError(reply, "user not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    const [result] = await db.query("INSERT INTO `items` (`seller_id`, `status`, `name`, `price`, `description`,`image_name`,`category_id`) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        seller.id,
        ItemStatusOnSale,
        name,
        price,
        description,
        imgName,
        category.id,
    ]);

    const itemId = result.insertId;

    const now = new Date();
    await db.query("UPDATE `users` SET `num_sell_items`=?, `last_bump`=? WHERE `id`=?", [
        seller.num_sell_items + 1,
        now,
        seller.id,
    ]);

    await db.commit();
    await db.release();

    reply
        .code(200)
        .type("application/json;charset=utf-8")
        .send({
            id: itemId,
        });

}

export async function postShip(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const csrfToken = req.body.csrf_token;
    const itemId = req.body.item_id;

    if (csrfToken !== req.cookies.csrf_token) {
        replyError(reply, "csrf token error", 422);
        return;
    }

    const db = await getDBConnection();

    const seller = await getLoginUser(req, db);

    if (seller === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }

    let transactionalEvidence: TransactionEvidence | null = null;
    {
        const [rows] = await db.query(
            "SELECT * FROM `transaction_evidences` WHERE `item_id` = ?",
            [itemId]
        )

        for (const row of rows) {
            transactionalEvidence = row as TransactionEvidence;
        }

    }

    if (transactionalEvidence === null) {
        replyError(reply, "transaction_evidences not found", 404);
        await db.release();
        return;
    }

    if (transactionalEvidence.seller_id !== seller.id) {
        replyError(reply, "権限がありません", 403);
        await db.release();
        return;
    }

    await db.beginTransaction();

    let item: Item | null = null;
    {
        const [rows] = await db.query(
            "SELECT * FROM `items` WHERE `id` = ? FOR UPDATE",
            [itemId]
        );
        for (const row of rows) {
            item = row as Item;
        }
    }

    if (item === null) {
        replyError(reply, "item not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    if (item.status !== ItemStatusTrading) {
        replyError(reply, "アイテムが取引中ではありません", 403);
        await db.rollback();
        await db.release();
        return;
    }

    {
        const [rows] = await db.query(
            "SELECT * FROM `transaction_evidences` WHERE `id` = ? FOR UPDATE",
            [
                transactionalEvidence.id,
            ]
        )
        if (rows.length === 0) {
            replyError(reply, "transaction_evidences not found", 404);
            await db.rollback();
            await db.release();
            return;
        }
    }

    if (transactionalEvidence.status !== TransactionEvidenceStatusWaitShipping) {
        replyError(reply, "準備ができていません", 403);
        await db.rollback();
        await db.release();
        return;
    }

    let shipping: Shipping | null = null;
    {
        const [rows] = await db.query(
            "SELECT * FROM `shippings` WHERE `transaction_evidence_id` = ? FOR UPDATE",
            [
                transactionalEvidence.id,
            ]
        );

        for (const row of rows) {
            shipping = row as Shipping;
        }
    }

    if (shipping === null) {
        replyError(reply, "shippings not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    const img = await shipmentRequest(await getShipmentServiceURL(db), {
        reserve_id: shipping.reserve_id,
    });

    await db.query(
        "UPDATE `shippings` SET `status` = ?, `img_binary` = ?, `updated_at` = ? WHERE `transaction_evidence_id` = ?",
        [
            ShippingsStatusWaitPickup,
            img,
            new Date(),
            transactionalEvidence.id,
        ]
    );

    await db.commit();
    await db.release();

    reply
        .code(200)
        .type("application/json")
        .send({
            path: `/transactions/${transactionalEvidence.id}.png`,
            reserve_id: shipping.reserve_id,
        });

}

export async function postShipDone(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const csrfToken = req.body.csrf_token;
    const itemId = req.body.item_id;

    if (csrfToken !== req.cookies.csrf_token) {
        replyError(reply, "csrf token error", 422);
        return;
    }

    const db = await getDBConnection();

    const seller = await getLoginUser(req, db)

    if (seller === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }

    let transactionEvidence: TransactionEvidence | null = null;
    {
        const [rows] = await db.query(
            "SELECT * FROM `transaction_evidences` WHERE `item_id` = ?",
            [
                itemId,
            ]
        );
        for (const row of rows) {
            transactionEvidence = row as TransactionEvidence;
        }
    }

    if (transactionEvidence === null) {
        replyError(reply, "transaction_evidence not found", 404);
        await db.release();
        return;
    }

    if (transactionEvidence.seller_id !== seller.id) {
        replyError(reply, "権限がありません", 403);
        await db.release();
        return;
    }

    await db.beginTransaction();

    let item: Item | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `items` WHERE `id` = ? FOR UPDATE", [
            itemId,
        ]);

        for (const row of rows) {
            item = row as Item;
        }

    }

    if (item === null) {
        replyError(reply, "items not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    if (item.status !== ItemStatusTrading) {
        replyError(reply, "商品が取引中ではありません", 403);
        await db.rollback();
        await db.release();
        return;
    }

    {
        const [rows] = await db.query(
            "SELECT * FROM `transaction_evidences` WHERE `id` = ? FOR UPDATE",
            [
                transactionEvidence.id,
            ]
        )
        for (const row of rows) {
            transactionEvidence = row as TransactionEvidence;
        }
    }

    if (transactionEvidence === null) {
        replyError(reply, "transaction_evidences not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    if (transactionEvidence.status !== TransactionEvidenceStatusWaitShipping) {
        replyError(reply, "準備ができていません", 403);
        await db.rollback();
        await db.release();
        return;
    }

    let shipping: Shipping | null = null;
    {
        const [rows] = await db.query(
            "SELECT * FROM `shippings` WHERE `transaction_evidence_id` = ? FOR UPDATE",
            [
                transactionEvidence.id,
            ]
        )

        for (const row of rows) {
            shipping = row as Shipping;
        }
    }

    if (shipping === null) {
        replyError(reply, "shippings not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    let params = {
        reserve_id: shipping.reserve_id,
    }
    try {
        const res = await shipmentStatus(await getShipmentServiceURL(db), params)
        if (!(res.status === ShippingsStatusShipping || res.status === ShippingsStatusDone)) {
            replyError(reply, "shipment service側で配送中か配送完了になっていません", 403);
            await db.rollback();
            await db.release();
            return;
        }

        await db.query(
            "UPDATE `shippings` SET `status` = ?, `updated_at` = ? WHERE `transaction_evidence_id` = ?",
            [
                res.status,
                new Date(),
                transactionEvidence.id,
            ]
        );

    } catch (res) {
        replyError(reply, "failed to request to shipment service");
        await db.rollback();
        await db.release();
        return;
    }

    await db.query(
        "UPDATE `transaction_evidences` SET `status` = ?, `updated_at` = ? WHERE `id` = ?",
        [
            TransactionEvidenceStatusWaitDone,
            new Date(),
            transactionEvidence.id,
        ]
    );

    await db.commit();
    await db.release();

    reply
        .code(200)
        .type("application/json;charset=utf-8")
        .send({
            transaction_evidence_id: transactionEvidence.id,
        });

}

export async function postComplete(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const csrfToken = req.body.csrf_token;
    const itemId = req.body.item_id;

    if (csrfToken !== req.cookies.csrf_token) {
        replyError(reply, "csrf token error", 422);
        return;
    }

    const db = await getDBConnection();
    const buyer = await getLoginUser(req, db);

    if (buyer === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }

    let transactionEvidence: TransactionEvidence | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `transaction_evidences` WHERE `item_id` = ?", [itemId])
        for (const row of rows) {
            transactionEvidence = row as TransactionEvidence;
        }
    }

    if (transactionEvidence === null) {
        replyError(reply, "transaction_evidence not found", 404);
        await db.release();
        return;
    }

    if (transactionEvidence.buyer_id !== buyer.id) {
        replyError(reply, "権限がありません", 403);
        await db.release();
        return;
    }

    await db.beginTransaction();

    let item: Item | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `items` WHERE `id` = ? FOR UPDATE", [itemId])
        for (const row of rows) {
            item = row as Item;
        }
    }

    if (item === null) {
        replyError(reply, "items not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    if (item.status !== ItemStatusTrading) {
        replyError(reply, "商品が取引中ではありません", 403);
        await db.rollback();
        await db.release();
        return;
    }

    {
        const [rows] = await db.query("SELECT * FROM `transaction_evidences` WHERE `item_id` = ? FOR UPDATE", [itemId])
        for (const row of rows) {
            transactionEvidence = row as TransactionEvidence;
        }
    }

    if (transactionEvidence === null) {
        replyError(reply, "transaction_evidences not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    if (transactionEvidence.status !== TransactionEvidenceStatusWaitDone) {
        replyError(reply, "準備ができていません", 403);
        await db.rollback();
        await db.release();
        return;
    }

    let shipping: Shipping | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `shippings` WHERE `transaction_evidence_id` = ? FOR UPDATE", [transactionEvidence.id]);
        for (const row of rows) {
            shipping = row as Shipping;
        }
    }

    if (shipping === null) {
        replyError(reply, "shipping not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    try {
        const res = await shipmentStatus(await getShipmentServiceURL(db), {
            reserve_id: shipping.reserve_id,
        })
        if (res.status !== ShippingsStatusDone) {
            replyError(reply, "shipment service側で配送完了になっていません", 400);
            await db.rollback();
            await db.release();
            return;
        }
    } catch (e) {
        replyError(reply, "failed to request to shipment service", 500);
        await db.rollback();
        await db.release();
        return;

    }

    await db.query("UPDATE `shippings` SET `status` = ?, `updated_at` = ? WHERE `transaction_evidence_id` = ?", [
        ShippingsStatusDone,
        new Date(),
        transactionEvidence.id,
    ])

    await db.query("UPDATE `transaction_evidences` SET `status` = ?, `updated_at` = ? WHERE `id` = ?", [
        TransactionEvidenceStatusDone,
        new Date(),
        transactionEvidence.id,
    ]);

    await db.query("UPDATE `items` SET `status` = ?, `updated_at` = ? WHERE `id` = ?", [
        ItemStatusSoldOut,
        new Date(),
        itemId,
    ]);

    await db.commit();
    await db.release();

    reply
        .code(200)
        .type("application/json;charset=utf-8")
        .send({
            transaction_evidence_id: transactionEvidence.id,
        });

}

export async function postBump(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const csrfToken = req.body.csrf_token;
    const itemId = req.body.item_id;

    if (csrfToken !== req.cookies.csrf_token) {
        replyError(reply, "csrf token error", 422);
        return;
    }

    const db = await getDBConnection();

    const user = await getLoginUser(req, db);
    if (user === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }


    await db.beginTransaction();

    let targetItem: Item | null = null;
    {
        const [rows] = await db.query(
            "SELECT * FROM `items` WHERE `id` = ? FOR UPDATE",
            [
                itemId,
            ]
        )
        for (const row of rows) {
            targetItem = row as Item;
        }
    }

    if (targetItem === null) {
        replyError(reply, "item not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    if (targetItem.seller_id !== user.id) {
        replyError(reply, "自分の商品以外は編集できません", 403);
        await db.rollback();
        await db.release();
        return;
    }

    let seller: User | null = null;
    {
        const [rows] = await db.query(
            "SELECT * FROM `users` WHERE `id` = ? FOR UPDATE",
            [
                user.id,
            ]
        );
        for (const row of rows) {
            seller = row as User;
        }
    }

    if (seller === null) {
        replyError(reply, "user not found", 404);
        await db.rollback();
        await db.release();
        return;
    }

    // last bump + 3s > 0
    const now = new Date();
    if (seller.last_bump.getTime() + BumpChargeSeconds > now.getTime()) {
        replyError(reply, "Bump not allowed", 403)
        await db.rollback();
        await db.release();
        return;
    }

    await db.query(
        "UPDATE `items` SET `created_at`=?, `updated_at`=? WHERE id=?",
        [
            now,
            now,
            targetItem.id,
        ]
    );

    await db.query("UPDATE `users` SET `last_bump`=? WHERE id=?", [now, seller.id])

    {
        const [rows] = await db.query("SELECT * FROM `items` WHERE `id` = ?", [itemId]);
        for (const row of rows) {
            targetItem = row as Item;
        }
    }

    await db.commit();
    await db.release();

    reply
        .code(200)
        .type("application/json;charset=utf-8")
        .send({
            item_id: targetItem.id,
            item_price: targetItem.price,
            item_created_at: targetItem.created_at.getTime(),
            item_updated_at: targetItem.updated_at.getTime(),
        });

}

export async function postLogin(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const rr: ReqLogin = req.body

    const accountName = rr.account_name;
    const password = rr.password;

    if (accountName === undefined || accountName === "" || password === undefined || password === "") {

        replyError(reply, "all parameters are required", 400);
        return;
    }

    const db = await getDBConnection();
    const [rows] = await db.query("SELECT * FROM `users` WHERE `account_name` = ?", [accountName])
    let user: User | null = null;
    for (const row of rows) {
        user = row as User;
    }

    if (user === null) {
        replyError(reply, "アカウント名かパスワードが間違えています", 401);
        await db.release();
        return;
    }

    if (!await comparePassword(password, user.hashed_password)) {
        replyError(reply, "アカウント名かパスワードが間違えています", 401);
        await db.release();
        return;
    }

    reply.setCookie("user_id", user.id.toString(), {
        path: "/",
    });
    reply.setCookie("csrf_token", await getRandomString(128), {
        path: "/",
    });

    await db.release();

    reply
        .code(200)
        .type("application/json;charset=utf-8")
        .send(user);

}

export async function postRegister(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const rr: ReqRegister = req.body


    const accountName = rr.account_name;
    const address = rr.address;
    const password = rr.password;

    if (accountName === undefined || accountName === "" || password === undefined || password === "" || address === undefined || address === "") {
        replyError(reply, "all parameters are required", 400);
        return;
    }

    const db = await getDBConnection();

    const [rows] = await db.query(
        "SELECT * FROM `users` WHERE `account_name` = ?",
        [
            accountName,
        ]
    );

    if (rows.length > 0) {
        replyError(reply, "アカウント名かパスワードが間違えています", 401);
        await db.release();
        return;
    }

    const hashedPassword = await encryptPassword(password);

    const [result,] = await db.query(
        "INSERT INTO `users` (`account_name`, `hashed_password`, `address`) VALUES (?, ?, ?)",
        [
            accountName,
            hashedPassword,
            address,
        ]
    );

    await db.release();

    const user = {
        id: result.insertId,
        account_name: accountName,
        address: address,
    };

    reply.setCookie("user_id", user.id.toString(), {
        path: "/",
    });

    reply.setCookie("csrf_token", await getRandomString(128), {
        path: "/",
    });

    reply
        .code(200)
        .type("application/json")
        .send(user);

}