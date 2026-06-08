const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.BASE_ID;


function safeValue(value) {

  if (value === undefined || value === null) {
    return "";
  }

  // Arrays → join into string
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  // Objects → stringify
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}


async function fetchTable(tableName) {

  let allRecords = [];
  let offset = null;

  do {

    let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`;

    if (offset) {
      url += `?offset=${offset}`;
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 60000);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Airtable Error: ${res.status}`);
    }

    const data = await res.json();

    allRecords.push(...data.records);

    offset = data.offset;

    console.log(
      `${tableName}: fetched ${allRecords.length} records`
    );

  } while (offset);

  return { records: allRecords };
}

async function migrateCookies() {

  const data = await fetchTable("Cookies");
  let sql = "";

  for (const record of data.records) {
    const fields = record.fields;
    sql += `
        INSERT INTO cookies (
            airtable_id,
            created_time,
            name_or_pattern,
            category,
            provider,
            purpose,
            retention,
            source,
            domain_pattern,
            is_pattern
        )
        VALUES (
            '${record.id.replace(/'/g, "''")}',
            '${record.createdTime.replace(/'/g, "''")}',

            '${safeValue(fields["Name or Pattern"]).replace(/'/g, "''")}',
            '${safeValue(fields["Category"]).replace(/'/g, "''")}',
            '${safeValue(fields["Provider"]).replace(/'/g, "''")}',
            '${safeValue(fields["Purpose"]).replace(/'/g, "''")}',
            '${safeValue(fields["Retention"]).replace(/'/g, "''")}',
            '${safeValue(fields["Source"]).replace(/'/g, "''")}',
            '${safeValue(fields["Domain Pattern"]).replace(/'/g, "''")}',
            ${fields["Is Pattern"] ? 1 : 0}
        );
        `;
  }
  return sql;
}

async function migrateTrackers() {

  const data = await fetchTable("Trackers");

  let sql = "";

  for (const record of data.records) {

    const fields = record.fields;

    sql += `
        INSERT INTO trackers (
            airtable_id,
            created_time,
            confidence,
            owner,
            provider,
            category,
            domain,
            sources,
            privacy_policy_url
        )
        VALUES (
            '${record.id.replace(/'/g, "''")}',
            '${record.createdTime.replace(/'/g, "''")}',

            '${safeValue(fields["Confidence"]).replace(/'/g, "''")}',
            '${safeValue(fields["Owner"]).replace(/'/g, "''")}',
            '${safeValue(fields["Provider"]).replace(/'/g, "''")}',
            '${safeValue(fields["Category"]).replace(/'/g, "''")}',
            '${safeValue(fields["Domain"]).replace(/'/g, "''")}',
            '${safeValue(fields["Sources"]).replace(/'/g, "''")}',
            '${safeValue(fields["Privacy Policy URL"]).replace(/'/g, "''")}'
        );
        `;
  }

  return sql;
}

async function migrateCmps() {
  const data = await fetchTable("CMP Signatures");
  let sql = "";

  for (const record of data.records) {
    const fields = record.fields;
    sql += `
        INSERT INTO cmps (
            airtable_id,
            created_time,
            display_name,
            vendor,
            status,
            notes,
            script_domains,
            dom_selectors,
            accept_selectors,
            reject_selectors,
            globals
        )
        VALUES (
            '${record.id.replace(/'/g, "''")}',
            '${record.createdTime.replace(/'/g, "''")}',

            '${safeValue(fields["Display Name"]).replace(/'/g, "''")}',
            '${safeValue(fields["Vendor"]).replace(/'/g, "''")}',
            '${safeValue(fields["Status"]).replace(/'/g, "''")}',
            '${safeValue(fields["Notes"]).replace(/'/g, "''")}',
            '${safeValue(fields["Script Domains"]).replace(/'/g, "''")}',
            '${safeValue(fields["DOM Selectors"]).replace(/'/g, "''")}',
            '${safeValue(fields["Accept Selectors"]).replace(/'/g, "''")}',
            '${safeValue(fields["Reject Selectors"]).replace(/'/g, "''")}',
            '${safeValue(fields["Globals"]).replace(/'/g, "''")}'
        );
        `;
  }

  return sql;
}

async function main() {

  const cookiesSQL = await migrateCookies();
  const trackersSQL = await migrateTrackers();
  const cmpsSQL = await migrateCmps();

  const fullSQL = cookiesSQL + trackersSQL + cmpsSQL;

  require("fs").writeFileSync("all_data.sql", fullSQL);

  console.log("Migration SQL generated");
}

main();