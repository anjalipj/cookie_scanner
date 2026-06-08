CREATE TABLE cookies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    airtable_id TEXT,
    created_time TEXT,
    name_or_pattern TEXT,
    category TEXT,
    provider TEXT,
    purpose TEXT,
    retention TEXT,
    is_pattern INTEGER,
    source TEXT,
    domain_pattern TEXT
);

CREATE TABLE trackers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    airtable_id TEXT,
    created_time TEXT,
    confidence TEXT,
    owner TEXT,
    provider TEXT,
    category TEXT,
    domain TEXT,
    sources TEXT,
    privacy_policy_url TEXT
);

CREATE TABLE cmps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    airtable_id TEXT,
    created_time TEXT,
    display_name TEXT,
    vendor TEXT,
    status TEXT,
    notes TEXT,
    script_domains TEXT,
    dom_selectors TEXT,
    accept_selectors TEXT,
    reject_selectors TEXT,
    globals TEXT
);
