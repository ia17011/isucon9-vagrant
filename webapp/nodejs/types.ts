
export type MySQLResultRows = Array<any> & { insertId: number };
export type MySQLColumnCatalogs = Array<any>;

export type MySQLResultSet = [MySQLResultRows, MySQLColumnCatalogs];

export interface MySQLQueryable {
    query(sql: string, params?: ReadonlyArray<any>): Promise<MySQLResultSet>;
}

export interface MySQLClient extends MySQLQueryable {
    beginTransaction(): Promise<void>;

    commit(): Promise<void>;

    rollback(): Promise<void>;

    release(): void;
}

export type Config = {
    name: string;
    val: string;
};

export type User = {
    id: number;
    account_name: string;
    hashed_password: string;
    address: string;
    num_sell_items: number;
    last_bump: Date;
    created_at: Date;
};

export type UserSimple = {
    id: number;
    account_name: string;
    num_sell_items: number;
};

export type Item = {
    id: number;
    seller_id: number;
    buyer_id: number;
    status: string;
    name: string;
    price: number;
    description: string;
    image_name: string;
    category_id: number;
    created_at: Date;
    updated_at: Date;
};

export type ItemSimple = {
    id: number;
    seller_id: number;
    seller: UserSimple;
    status: string;
    name: string;
    price: number;
    image_url: string;
    category_id: number;
    category: Category;
    created_at: number;
};

export type ItemDetail = {
    id: number;
    seller_id: number;
    seller: UserSimple;
    buyer_id?: number;
    buyer?: UserSimple;
    status: string;
    name: string;
    price: number;
    description: string;
    image_url: string;
    category_id: number;
    category: Category;
    transaction_evidence_id?: number;
    transaction_evidence_status?: string;
    shipping_status?: string;
    created_at: number;
};

export type TransactionEvidence = {
    id: number;
    seller_id: number;
    buyer_id: number;
    status: string;
    item_id: string;
    item_name: string;
    item_price: number;
    item_description: string;
    item_category_id: number;
    item_root_category_id: number;
    created_at: Date;
    updated_at: Date;
};

export type Shipping = {
    transaction_evidence_id: number;
    status: string;
    item_name: string;
    item_id: number;
    reserve_id: string;
    reserve_time: number;
    to_address: string;
    to_name: string;
    from_address: string;
    from_name: string;
    img_binary: Uint8Array,
};

export type Category = {
    id: number,
    parent_id: number,
    category_name: string,
    parent_category_name?: string,
};

export type ReqInitialize = {
    payment_service_url: string;
    shipment_service_url: string;
};

export type ReqRegister = {
    account_name?: string,
    address?: string,
    password?: string,
}

export type ReqLogin = {
    account_name?: string,
    password?: string,
}

export type ResNewItems = {
    root_category_id?: number,
    root_category_name?: string,
    has_next: boolean,
    items: ItemSimple[],
}

export type ResUserItems = {
    user: UserSimple,
    has_next: boolean,
    items: ItemSimple[],
}