import crypt from "crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import { ServerResponse } from "http";
import { getDBConnection } from ".";
import { shipmentStatus } from "./api";
import { DefaultPaymentServiceURL, DefaultShipmentServiceURL, ItemsPerPage, ItemStatusCancel, ItemStatusOnSale, ItemStatusSoldOut, ItemStatusStop, ItemStatusTrading, ShippingsStatusShipping, ShippingsStatusWaitPickup, TransactionsPerPage } from "./constants";
import { replyError } from "./initial";
import { Category, Config, Item, ItemDetail, ItemSimple, MySQLQueryable, ResNewItems, ResUserItems, Shipping, TransactionEvidence, User, UserSimple } from "./types";

export async function getNewItems(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const query = req.query;
    let itemId = 0;
    if (query['item_id'] !== undefined) {
        itemId = parseInt(query['item_id'], 10);
        if (isNaN(itemId) || itemId <= 0) {
            replyError(reply, "item_id param error", 400);
            return
        }
    }

    let createdAt = 0;
    if (query['created_at'] !== undefined) {
        createdAt = parseInt(query['created_at'], 10);
        if (isNaN(createdAt) || createdAt <= 0) {
            replyError(reply, "created_at param error", 400);
            return
        }
    }

    const items: Item[] = [];
    const db = await getDBConnection();
    if (itemId > 0 && createdAt > 0) {
        const [rows,] = await db.query(
            "SELECT * FROM `items` WHERE `status` IN (?,?) AND (`created_at` < ? OR (`created_at` <= ? AND `id` < ?)) ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
            [
                ItemStatusOnSale,
                ItemStatusSoldOut,
                new Date(createdAt),
                new Date(createdAt),
                itemId,
                ItemsPerPage + 1,
            ],
        );
        for (const row of rows) {
            items.push(row as Item);
        }
    } else {
        const [rows,] = await db.query(
            "SELECT * FROM `items` WHERE `status` IN (?,?) ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
            [
                ItemStatusOnSale,
                ItemStatusSoldOut,
                ItemsPerPage + 1,
            ],
        );
        for (const row of rows) {
            items.push(row as Item);
        }
    }

    let itemSimples: ItemSimple[] = [];

    for (const item of items) {
        const seller = await getUserSimpleByID(db, item.seller_id);
        if (seller === null) {
            replyError(reply, "seller not found", 404)
            await db.release();
            return;
        }
        const category = await getCategoryByID(db, item.category_id);
        if (category === null) {
            replyError(reply, "category not found", 404)
            await db.release();
            return;
        }

        itemSimples.push({
            id: item.id,
            seller_id: item.seller_id,
            seller: seller,
            status: item.status,
            name: item.name,
            price: item.price,
            image_url: getImageURL(item.image_name),
            category_id: item.category_id,
            category: category,
            created_at: item.created_at.getTime(),
        });
    }

    let hasNext = false;
    if (itemSimples.length > ItemsPerPage) {
        hasNext = true;
        itemSimples = itemSimples.slice(0, itemSimples.length - 1)
    }
    const res: ResNewItems = {
        has_next: hasNext,
        items: itemSimples,
    };

    await db.release();

    reply
        .code(200)
        .type("application/json")
        .send(res);
}

export async function getNewCategoryItems(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const rootCategoryIdStr: string = req.params.root_category_id;
    const rootCategoryId: number = parseInt(rootCategoryIdStr, 10);
    if (rootCategoryId === null || isNaN(rootCategoryId)) {
        replyError(reply, "incorrect category id", 400);
        return;
    }

    const db = await getDBConnection();
    const rootCategory = await getCategoryByID(db, rootCategoryId);
    if (rootCategory === null || rootCategory.parent_id !== 0) {
        replyError(reply, "category not found");
        await db.release();
        return;
    }

    const categoryIDs: number[] = [];
    const [rows,] = await db.query("SELECT id FROM `categories` WHERE parent_id=?", [rootCategory.id]);
    for (const row of rows) {
        categoryIDs.push(row.id);
    }

    const itemIDStr = req.query.item_id;
    let itemID = 0;
    if (itemIDStr !== undefined && itemIDStr !== "") {
        itemID = parseInt(itemIDStr, 10);
        if (isNaN(itemID) || itemID <= 0) {
            replyError(reply, "item_id param error", 400);
            await db.release();
            return;
        }
    }
    const createdAtStr = req.query.created_at;
    let createdAt = 0;
    if (createdAtStr !== undefined && createdAtStr !== "") {
        createdAt = parseInt(createdAtStr, 10);
        if (isNaN(createdAt) || createdAt <= 0) {
            replyError(reply, "created_at param error", 400);
            await db.release();
            return;
        }
    }

    const items: Item[] = [];
    if (itemID > 0 && createdAt > 0) {
        const [rows] = await db.query(
            "SELECT * FROM `items` WHERE `status` IN (?,?) AND category_id IN (?) AND (`created_at` < ? OR (`created_at` <= ? AND `id` < ?)) ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
            [
                ItemStatusOnSale,
                ItemStatusSoldOut,
                categoryIDs,
                new Date(createdAt),
                new Date(createdAt),
                itemID,
                ItemsPerPage + 1,
            ]
        );

        for (const row of rows) {
            items.push(row as Item);
        }
    } else {
        const [rows] = await db.query(
            "SELECT * FROM `items` WHERE `status` IN (?,?) AND category_id IN (?) ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
            [
                ItemStatusOnSale,
                ItemStatusSoldOut,
                categoryIDs,
                ItemsPerPage + 1,
            ]
        );

        for (const row of rows) {
            items.push(row as Item);
        }
    }

    let itemSimples: ItemSimple[] = [];

    for (const item of items) {
        const seller = await getUserSimpleByID(db, item.seller_id);
        if (seller === null) {
            replyError(reply, "seller not found", 404)
            await db.release();
            return;
        }
        const category = await getCategoryByID(db, item.category_id);
        if (category === null) {
            replyError(reply, "category not found", 404)
            await db.release();
            return;
        }

        itemSimples.push({
            id: item.id,
            seller_id: item.seller_id,
            seller: seller,
            status: item.status,
            name: item.name,
            price: item.price,
            image_url: getImageURL(item.image_name),
            category_id: item.category_id,
            category: category,
            created_at: item.created_at.getTime(),
        });
    }

    let hasNext = false;
    if (itemSimples.length > ItemsPerPage) {
        hasNext = true;
        itemSimples = itemSimples.slice(0, itemSimples.length - 1)
    }

    const res = {
        root_category_id: rootCategory.id,
        root_category_name: rootCategory.category_name,
        items: itemSimples,
        has_next: hasNext,
    }

    await db.release();

    reply
        .code(200)
        .type("application/json")
        .send(res);

}

export async function getTransactions(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const db = await getDBConnection();
    const user = await getLoginUser(req, db);

    if (user === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }

    const query = req.query;
    let itemId = 0;
    if (query['item_id'] !== undefined) {
        itemId = parseInt(query['item_id'], 10);
        if (isNaN(itemId) || itemId <= 0) {
            replyError(reply, "item_id param error", 400);
            await db.release();
            return
        }
    }

    let createdAt = 0;
    if (query['created_at'] !== undefined) {
        createdAt = parseInt(query['created_at'], 10);
        if (isNaN(createdAt) || createdAt <= 0) {
            replyError(reply, "created_at param error", 400);
            await db.release();
            return
        }
    }

    await db.beginTransaction();
    const items: Item[] = [];
    if (itemId > 0 && createdAt > 0) {
        const [rows] = await db.query(
            "SELECT * FROM `items` WHERE (`seller_id` = ? OR `buyer_id` = ?) AND `status` IN (?,?,?,?,?) AND (`created_at` < ? OR (`created_at` <= ? AND `id` < ?)) ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
            [
                user.id,
                user.id,
                ItemStatusOnSale,
                ItemStatusTrading,
                ItemStatusSoldOut,
                ItemStatusCancel,
                ItemStatusStop,
                new Date(createdAt),
                new Date(createdAt),
                itemId,
                TransactionsPerPage + 1,
            ]
        );

        for (const row of rows) {
            items.push(row as Item);
        }

    } else {
        const [rows] = await db.query(
            "SELECT * FROM `items` WHERE (`seller_id` = ? OR `buyer_id` = ?) AND `status` IN (?,?,?,?,?) ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
            [
                user.id,
                user.id,
                ItemStatusOnSale,
                ItemStatusTrading,
                ItemStatusSoldOut,
                ItemStatusCancel,
                ItemStatusStop,
                TransactionsPerPage + 1
            ]
        );

        for (const row of rows) {
            items.push(row as Item);
        }
    }

    let itemDetails: ItemDetail[] = [];
    for (const item of items) {
        const category = await getCategoryByID(db, item.category_id);
        if (category === null) {
            replyError(reply, "category not found", 404)
            await db.rollback();
            await db.release();
            return;
        }

        const seller = await getUserSimpleByID(db, item.seller_id);
        if (seller === null) {
            replyError(reply, "seller not found", 404)
            await db.rollback();
            await db.release();
            return;
        }

        const itemDetail: ItemDetail = {
            id: item.id,
            seller_id: item.seller_id,
            seller: seller,
            // buyer_id
            // buyer
            status: item.status,
            name: item.name,
            price: item.price,
            description: item.description,
            image_url: getImageURL(item.image_name),
            category_id: item.category_id,
            category: category,
            // transaction_evidence_id
            // transaction_evidence_status
            // shipping_status
            created_at: item.created_at.getTime(),
        };

        if (item.buyer_id !== undefined && item.buyer_id !== 0) {
            const buyer = await getUserSimpleByID(db, item.buyer_id);
            if (buyer === null) {
                replyError(reply, "buyer not found", 404);
                await db.rollback();
                await db.release();
                return;
            }
            itemDetail.buyer_id = item.buyer_id;
            itemDetail.buyer = buyer;
        }

        const [rows] = await db.query("SELECT * FROM `transaction_evidences` WHERE `item_id` = ?", [item.id]);
        let transactionEvidence: TransactionEvidence | null = null;
        for (const row of rows) {
            transactionEvidence = row as TransactionEvidence;
        }

        if (transactionEvidence !== null) {
            const [rows] = await db.query("SELECT * FROM `shippings` WHERE `transaction_evidence_id` = ?", [transactionEvidence.id]);

            let shipping: Shipping | null = null;
            for (const row of rows) {
                shipping = row as Shipping;
            }

            if (shipping === null) {
                replyError(reply, "shipping not found", 404);
                await db.rollback();
                await db.release();
                return;
            }

            try {
                const res = await shipmentStatus(await getShipmentServiceURL(db), { reserve_id: shipping.reserve_id });
                itemDetail.shipping_status = res.status;
            } catch (error) {
                replyError(reply, "failed to request to shipment service");
                await db.rollback();
                await db.release();
                return;
            }

            itemDetail.transaction_evidence_id = transactionEvidence.id;
            itemDetail.transaction_evidence_status = transactionEvidence.status;
        }

        itemDetails.push(itemDetail);

    }

    await db.commit();

    let hasNext = false;
    if (itemDetails.length > TransactionsPerPage) {
        hasNext = true;
        itemDetails = itemDetails.slice(0, TransactionsPerPage);
    }

    await db.release();

    reply
        .code(200)
        .type("application/json;charset=utf-8")
        .send({ has_next: hasNext, items: itemDetails });

}

export async function getUserItems(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const userIdStr = req.params.user_id;
    const userId = parseInt(userIdStr, 10);
    if (userId === undefined || isNaN(userId)) {
        replyError(reply, "incorrect user id", 400);
        return;
    }

    const db = await getDBConnection();
    const userSimple = await getUserSimpleByID(db, userId);
    if (userSimple === null) {
        replyError(reply, "user not found", 404);
        await db.release();
        return;
    }

    const itemIDStr = req.query.item_id;
    let itemID = 0;
    if (itemIDStr !== undefined && itemIDStr !== "") {
        itemID = parseInt(itemIDStr, 10);
        if (isNaN(itemID) || itemID <= 0) {
            replyError(reply, "item_id param error", 400);
            await db.release();
            return;
        }
    }
    const createdAtStr = req.query.created_at;
    let createdAt = 0;
    if (createdAtStr !== undefined && createdAtStr !== "") {
        createdAt = parseInt(createdAtStr, 10);
        if (isNaN(createdAt) || createdAt <= 0) {
            replyError(reply, "created_at param error", 400);
            await db.release();
            return;
        }
    }

    const items: Item[] = [];
    if (itemID > 0 && createdAt > 0) {
        const [rows] = await db.query(
            "SELECT * FROM `items` WHERE `seller_id` = ? AND `status` IN (?,?,?) AND (`created_at` < ? OR (`created_at` <= ? AND `id` < ?)) ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
            [
                userSimple.id,
                ItemStatusOnSale,
                ItemStatusTrading,
                ItemStatusSoldOut,
                new Date(createdAt),
                new Date(createdAt),
                itemID,
                ItemsPerPage + 1,
            ]
        );

        for (const row of rows) {
            items.push(row as Item);
        }
    } else {
        const [rows] = await db.query(
            "SELECT * FROM `items` WHERE `seller_id` = ? AND `status` IN (?,?,?) ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
            [
                userSimple.id,
                ItemStatusOnSale,
                ItemStatusTrading,
                ItemStatusSoldOut,
                ItemsPerPage + 1,
            ]
        );

        for (const row of rows) {
            items.push(row as Item);
        }
    }

    let itemSimples: ItemSimple[] = [];
    for (const item of items) {
        const category = await getCategoryByID(db, item.category_id);
        if (category === null) {
            replyError(reply, "category not found", 404)
            await db.release();
            return;
        }

        itemSimples.push({
            id: item.id,
            seller_id: item.seller_id,
            seller: userSimple,
            status: item.status,
            name: item.name,
            price: item.price,
            image_url: getImageURL(item.image_name),
            category_id: item.category_id,
            category: category,
            created_at: item.created_at.getTime(),
        });
    }

    let hasNext = false;
    if (itemSimples.length > ItemsPerPage) {
        hasNext = true;
        itemSimples = itemSimples.slice(0, ItemsPerPage);
    }
    const res: ResUserItems = {
        user: userSimple,
        has_next: hasNext,
        items: itemSimples,
    };

    await db.release();

    reply
        .code(200)
        .type("application/json")
        .send(res);
}

export async function getItem(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const itemIdStr = req.params.item_id;
    const itemId = parseInt(itemIdStr, 10);
    if (itemId === undefined || isNaN(itemId)) {
        replyError(reply, "incorrect item id", 400);
        return;
    }

    const db = await getDBConnection();
    const user = await getLoginUser(req, db);
    if (user === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }

    const [rows] = await db.query("SELECT * FROM `items` WHERE `id` = ?", [itemId]);
    let item: Item | null = null;

    for (const row of rows) {
        item = row as Item;
    }

    if (item === null) {
        replyError(reply, "item not found", 404);
        await db.release();
        return;
    }

    const category = await getCategoryByID(db, item.category_id);
    if (category === null) {
        replyError(reply, "category not found", 404)
        await db.release();
        return;
    }

    const seller = await getUserSimpleByID(db, item.seller_id);
    if (seller === null) {
        replyError(reply, "seller not found", 404)
        await db.release();
        return;
    }

    const itemDetail: ItemDetail = {
        id: item.id,
        seller_id: item.seller_id,
        seller: seller,
        // buyer_id
        // buyer
        status: item.status,
        name: item.name,
        price: item.price,
        description: item.description,
        image_url: getImageURL(item.image_name),
        category_id: item.category_id,
        category: category,
        // transaction_evidence_id
        // transaction_evidence_status
        // shipping_status
        created_at: item.created_at.getTime(),
    };

    if ((user.id === item.seller_id || user.id === item.buyer_id) && item.buyer_id !== 0) {
        const buyer = await getUserSimpleByID(db, item.buyer_id);
        if (buyer === null) {
            replyError(reply, "buyer not found", 404);
            await db.release();
            return;
        }

        itemDetail.buyer_id = item.buyer_id;
        itemDetail.buyer = buyer;

        const [rows] = await db.query("SELECT * FROM `transaction_evidences` WHERE `item_id` = ?", [item.id]);
        let transactionEvidence: TransactionEvidence | null = null;
        for (const row of rows) {
            transactionEvidence = row as TransactionEvidence;
        }

        if (transactionEvidence !== null) {
            const [rows] = await db.query("SELECT * FROM `shippings` WHERE `transaction_evidence_id` = ?", [transactionEvidence.id])
            let shipping: Shipping | null = null;
            for (const row of rows) {
                shipping = row as Shipping;
            }

            if (shipping === null) {
                replyError(reply, "shipping not found", 404);
                await db.release();
                return;
            }

            itemDetail.transaction_evidence_id = transactionEvidence.id;
            itemDetail.transaction_evidence_status = transactionEvidence.status;
            itemDetail.shipping_status = shipping.status;
        }

    }

    await db.release();

    reply
        .code(200)
        .type("application/json")
        .send(itemDetail);
}

export async function getQRCode(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const transactionEvidenceIdStr: string = req.params.transaction_evidence_id;
    const transactionEvidenceId: number = parseInt(transactionEvidenceIdStr, 10);
    if (transactionEvidenceId === null || isNaN(transactionEvidenceId)) {
        replyError(reply, "incorrect transaction_evidence id", 400);
        return;
    }

    const db = await getDBConnection();
    const seller = await getLoginUser(req, db);
    if (seller === null) {
        replyError(reply, "no session", 404);
        await db.release();
        return;
    }

    let transactionEvidence: TransactionEvidence | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `transaction_evidences` WHERE `id` = ?", [transactionEvidenceId]);
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

    let shipping: Shipping | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `shippings` WHERE `transaction_evidence_id` = ?", [transactionEvidence.id]);
        for (const row of rows) {
            shipping = row as Shipping;
        }
    }

    if (shipping === null) {
        replyError(reply, "shippings not found", 404);
        await db.release();
        return;
    }

    if (shipping.status !== ShippingsStatusWaitPickup && shipping.status !== ShippingsStatusShipping) {
        replyError(reply, "qrcode not available", 403);
        await db.release();
        return;
    }

    if (shipping.img_binary.byteLength === 0) {
        replyError(reply, "empty qrcode image")
        await db.release();
        return;
    }

    await db.release();

    reply
        .code(200)
        .type("image/png")
        .send(shipping.img_binary);

}

export async function getUserSimpleByID(db: MySQLQueryable, userID: number): Promise<UserSimple | null> {
    const [rows,] = await db.query("SELECT * FROM `users` WHERE `id` = ?", [userID]);
    for (const row of rows) {
        const user = row as User;
        const userSimple: UserSimple = {
            id: user.id,
            account_name: user.account_name,
            num_sell_items: user.num_sell_items,
        };
        return userSimple;
    }
    return null;
}

export async function getCategoryByID(db: MySQLQueryable, categoryId: number): Promise<Category | null> {
    const [rows,] = await db.query("SELECT * FROM `categories` WHERE `id` = ?", [categoryId]);
    for (const row of rows) {
        const category = row as Category;
        if (category.parent_id !== undefined && category.parent_id != 0) {
            const parentCategory = await getCategoryByID(db, category.parent_id);
            if (parentCategory !== null) {
                category.parent_category_name = parentCategory.category_name
            }
        }
        return category;
    }
    return null;
}

export async function getSettings(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const csrfToken = req.cookies.csrf_token;

    const db = await getDBConnection();
    const user = await getLoginUser(req, db);

    const res = {
        user: null as User | null,
        payment_service_url: null as string | null,
        categories: null as Category[] | null,
        csrf_token: null as string | null,
    };

    res.user = user;
    res.payment_service_url = await getPaymentServiceURL(db);
    res.csrf_token = csrfToken;

    const categories: Category[] = [];
    const [rows] = await db.query("SELECT * FROM `categories`", []);
    for (const row of rows) {
        categories.push(row as Category);
    }
    res.categories = categories;

    await db.release();

    reply
        .code(200)
        .type("application/json")
        .send(res)

}


export async function getReports(req: FastifyRequest, reply: FastifyReply<ServerResponse>) {
    const db = await getDBConnection();
    const [rows] = await db.query("SELECT * FROM `transaction_evidences` WHERE `id` > 15007");
    const transactionEvidences: TransactionEvidence[] = [];
    for (const row of rows) {
        transactionEvidences.push(row as TransactionEvidence);
    }

    await db.release();

    reply
        .code(200)
        .type("application/json")
        .send(transactionEvidences);
}

export async function getLoginUser(req: FastifyRequest, db: MySQLQueryable): Promise<User | null> {
    let userId: number;
    if (req.cookies.user_id !== undefined && req.cookies.user_id !== "") {
        const [rows] = await db.query("SELECT * FROM `users` WHERE `id` = ?", [req.cookies.user_id]);
        for (const row of rows) {
            const user = row as User;
            return user;
        }
    }

    return null;
}

export async function getRandomString(length: number): Promise<string> {
    return await new Promise((resolve) => {
        crypt.randomBytes(length, (err, buffer) => {
            resolve(buffer.toString('hex'));
        })
    });
}

export async function getConfigByName(db: MySQLQueryable, name: string): Promise<string | null> {
    let config: Config | null = null;
    {
        const [rows] = await db.query("SELECT * FROM `configs` WHERE `name` = ?", [name]);
        for (const row of rows) {
            config = row as Config;
        }
    }

    if (config === null) {
        return null;
    }

    return config.val;
}

export async function getPaymentServiceURL(db: MySQLQueryable): Promise<string> {
    const result = await getConfigByName(db, "payment_service_url");
    if (result === null) {
        return DefaultPaymentServiceURL;
    }
    return result;
}

export async function getShipmentServiceURL(db: MySQLQueryable): Promise<string> {
    const result = await getConfigByName(db, "shipment_service_url");
    if (result === null) {
        return DefaultShipmentServiceURL;
    }
    return result;
}

export function getImageURL(imageName: string) {
    return `/upload/${imageName}`;
}