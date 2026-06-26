CREATE TABLE scan_reports (
    id TEXT PRIMARY KEY,
    scanned_url TEXT NOT NULL,
    report_data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
