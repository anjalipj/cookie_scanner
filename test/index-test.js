
import { launch } from "@cloudflare/playwright";
// import { getCookieData, getCookies } from "./Airtable_DBs/airtable_cookie_db";
// import { getTrackerData,getTrackers } from "./Airtable_DBs/airtable_tracker_db";
// import { getCmpData,getCmps } from "./Airtable_DBs/airtable_cmp_db";

let trackerCache = null;
let cmpCache = null;

const corsHeaders = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type"
	};

export default {

  async fetch(request, env) {


    // Handle CORS
    if (request.method === "OPTIONS") {

		return new Response(null, {
			status: 204,
			headers: corsHeaders
		});
	}

	//if get method
	if (request.method === "GET") {
		return Response.json(
			{
			status: "Worker running successfully"
			},
			{
			headers: corsHeaders
			}
		);
	}

    // Allow only POST
    if (request.method !== "POST") {
      return new Response(
        "Method not allowed",
        {
			status: 405,
			headers: corsHeaders
		}
      );
    }

	
	// ....Tracker funtion....
	async function matchTrackers(domains, env) {
		console.log("matchtracker function");
		
		if (!trackerCache) {
			const trackerRows = await env.cookie_scanner_db
				.prepare(`
					SELECT provider, category, owner, domain
					FROM trackers
				`)
				.all();
			trackerCache = trackerRows.results;
		}

		const trackers = trackerCache;

		const detected = [];
		const undetected = [];
		const uniqueTrackersMap = new Map();

		for (const domain of domains) {

			let isMatched = false;

			for (const tracker of trackers) {

			const trackerDomain = tracker.domain?.toLowerCase().trim();

			if (
				domain === trackerDomain ||
				domain.endsWith("." + trackerDomain) ||
				trackerDomain.endsWith("." + domain)
			) {

				isMatched = true;

				detected.push({
				name: tracker.provider,
				category: tracker.category,
				owner: tracker.owner,
				status: "Known",
				matchedDomain: domain
				});

				if (!uniqueTrackersMap.has(tracker.provider)) {

				uniqueTrackersMap.set(
					tracker.provider,
					{
					name: tracker.provider,
					category: tracker.category,
					owner: tracker.owner,
					status: "Known"
					}
				);
				}

				break;
			}
			}

			if (!isMatched) {
			undetected.push({
				name: domain,
				category: "Unknown",
				company: "Unknown",
				status: "Unknown"
			});
			}
		}

		return {
			totalDetectedTrackers: detected.length,
			totalUndetectedTrackers: undetected.length,
			uniqueTrackers: [...uniqueTrackersMap.values()]
		};
	}


	
	//....CMP detection Function.....
	async function detectCMP(requestDomains, env){

		if (!cmpCache) {
			const cmpRows = await env.cookie_scanner_db
				.prepare(`
					SELECT display_name,vendor,script_domains,accept_selectors
					FROM cmps
				`)
				.all();
			cmpCache = cmpRows.results;
		}

		const cmps = cmpCache;

		const detectedCMPs = [];

		for (const cmp of cmps) {

			const displayName = cmp.display_name;
			const vendor = cmp.vendor;

			let domainMatched = false;

			if (cmp.script_domains) {

			const scriptDomains =
				cmp.script_domains
				.split(",")
				.map(d => d.trim().toLowerCase());

			domainMatched = requestDomains.some(domain => {

				return scriptDomains.some(scriptDomain =>

				domain === scriptDomain ||
				domain.endsWith("." + scriptDomain)

				);

			});

			}

			if (domainMatched) {

			detectedCMPs.push({
				name: displayName,
				vendor: vendor,
				acceptSelector: cmp.accept_selectors
			});

			}

		}

		return detectedCMPs;
	}


	//...parsecookies function...
	function parseSetCookie(setCookieStr, responseUrl) {
		const results = [];
		const lines = setCookieStr.split("\n");

		for (const line of lines) {
			const parts = line.split(";").map(p => p.trim());
			if (!parts[0] || !parts[0].includes("=")) continue;

			const [rawName, ...valParts] = parts[0].split("=");

			const cookie = {
				name: rawName.trim(),
				value: valParts.join("="),
				domain: "",
				path: "/",
				expires: -1, // session cookie by default
				httpOnly: false,
				secure: false,
				sameSite: "Lax"
			};

	    for (let i = 1; i < parts.length; i++) {
	      const [k, v] = parts[i].split("=");
	      const key = (k || "").toLowerCase().trim();
	      const val = (v || "").trim();

	      switch (key) {
	        case "domain":
	          cookie.domain = val.replace(/^\./, "");
	          break;
	        case "path":
	          cookie.path = val;
	          break;
	        case "expires":
	          // convert to unix seconds to match context.cookies() format
	          try {
	            const t = Date.parse(val);
	            if (!isNaN(t)) cookie.expires = Math.floor(t / 1000);
	          } catch {}
	          break;
	        case "max-age":
	          // max-age is relative seconds; we can't compute absolute without "now",
	          // so just store it so you know it's persistent
	          cookie.maxAge = parseInt(val, 10);
	          break;
	        case "httponly":
	          cookie.httpOnly = true;
	          break;
	        case "secure":
	          cookie.secure = true;
	          break;
	        case "samesite":
	          cookie.sameSite = val || "Lax";
	          break;
	      }
	    }

	    if (!cookie.domain && responseUrl) {
	      try { cookie.domain = new URL(responseUrl).hostname.replace(/^www\./, ""); } catch {}
	    }

	    results.push(cookie);
	  }

	  return results;
	}



	let browser;
    try {

		const trackerCount = await env.cookie_scanner_db.prepare("SELECT COUNT(*) as total FROM trackers").first();
		console.log("Trackers rows:", trackerCount);

		const cmpCount = await env.cookie_scanner_db.prepare("SELECT COUNT(*) as total FROM cmps").first();
		console.log("CMP rows:", cmpCount);

		const cookieCount = await env.cookie_scanner_db.prepare("SELECT COUNT(*) as total FROM cookies").first();
		console.log("Cookie rows:", cookieCount);

		// await getCookieData(env);
		// await getTrackerData(env);
		// await getCmpData(env);


		// Get body
		const body = await request.json();

		const targetUrl = body.url;

		// scan deadline — hard cap the whole scan at 60s
		const scanStart = Date.now();
		const SCAN_DEADLINE_MS = 60000;
		const timeLeft = () => SCAN_DEADLINE_MS - (Date.now() - scanStart);

		// Launch browser
		browser = await launch(env.MYBROWSER, {
			args: [
				"--disable-features=BlockThirdPartyCookies,ThirdPartyCookieBlocking",
				"--disable-blink-features=BlockCredentialedSubresources",
				"--no-sandbox",
			]
		});

		const context = await browser.newContext({
			// Allow all cookies
			extraHTTPHeaders: {
				"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
			// Bypass cookie restrictions
			ignoreHTTPSErrors: true,
			javaScriptEnabled: true,
			bypassCSP: true,
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
		});

		const page = await context.newPage();

		let networkRequests = new Set();
		let requestDomains = new Set();

		// Listen for requests
		page.on("request", request => {
			networkRequests.add(request.url());
			try {
				const domain = new URL(request.url()).hostname.replace("www.", "").toLowerCase();
				requestDomains.add(domain);
			} catch (err) {}
		});


		//getting cookies in header
		const responseCookies = [];
		page.on("response", async (response) => {
		try {
			const headers = await response.allHeaders();   // async + includes set-cookie

			if (headers["set-cookie"]) {
			responseCookies.push({
				url: response.url(),
				setCookie: headers["set-cookie"]
			});
			}
		} catch (err) {
			// response may already be gone; ignore
		}
		});
		

		//getting cookies in iframe
		const frames = page.frames();
		

		// open website
		await page.goto(targetUrl, {
			waitUntil: "domcontentloaded",
			timeout: 45000
		});

		try {
			await page.waitForLoadState("networkidle", { timeout: 15000 });
		} catch (e) {
			console.log("Network never went idle (expected on tracker-heavy sites) — continuing");
		}

		// wait for delayed cookies
		await page.waitForTimeout(20000);


		console.log("Response Cookies:", responseCookies.length);
		for (const frame of frames) {
			console.log(frame.url());
		}
		

		//matchtracker function call
		const trackerResult = await matchTrackers([...requestDomains],env);
		console.log(trackerResult)



		//detectCMP function call
		const CMPs = await detectCMP([...requestDomains],env)
		console.log("Detected CMPs:",CMPs);



		//getting the html of the website
		const html =await page.content()
		const htmlLower =html.toLowerCase();



		//Dom signals
		let domSignals ={cmp:CMPs, cookieBanner:false, rejectButton:false, privacyLink:false}
		
		const bannerElement = await page.$(`[id*="cookie"],
											[class*="cookie"],
											[id*="consent"],
											[class*="consent"],
											[aria-label*="cookie"]
										`);
		if(bannerElement){
			domSignals.cookieBanner = true
		}

		if(domSignals.cookieBanner){
			const rejectButton = await page.$(`button:has-text("Reject"),
												button:has-text("Decline"),
												button:has-text("Deny"),
												button:has-text("Reject all"),
												[aria-label*="reject"],
												[id*="reject"],
												[class*="reject"]
											`);

			if (rejectButton) {
				domSignals.rejectButton = true;
			}
		}

		const privacyLink =await page.$(`a[href*="privacy"],
										a[href*="cookie"],
										a:has-text("Privacy"),
										a:has-text("Cookie")`);
		const privacyHtml = htmlLower.includes("privacy policy") ||htmlLower.includes("cookie policy");

		if (privacyLink|| privacyHtml) {
			domSignals.privacyLink = true;
		}
		console.log("Dom Signals:", domSignals)
		


		//checking is there any trackers before consent
		const hasPreConsentTracking = trackerResult.uniqueTrackers.some(tracker => {
			const category =tracker.category.toLowerCase();
			return (category.includes("analytics") ||category.includes("marketing") ||category.includes("advertisement") ||category.includes("behavioral"));
		});
		console.log("Trackers Before Consent:",hasPreConsentTracking);



		//setting compliance score and grade
		let complianceScore = 0
		if(domSignals.cmp.length > 0){ 
		complianceScore+=20 
		}
		if(domSignals.cookieBanner){
		complianceScore+=20
		}
		if(domSignals.rejectButton){
		complianceScore+=20
		}
		if(domSignals.privacyLink){
		complianceScore+=20
		}
		if(!hasPreConsentTracking){
		complianceScore+=20
		}

		let grade="F"
		if(complianceScore>=80){
		grade="A"
		}
		else if(complianceScore>=70){
		grade="B"
		}
		else if(complianceScore>=60){
		grade="C"
		}
		else if(complianceScore>=40){
		grade="D"
		}
		console.log("Compliance score:",complianceScore);
		console.log("Grade:",grade);



		// Get cookies
		// const cookiesBefore =	await context.cookies();
		// await page.waitForTimeout(5000);
		// const cookiesAfter =await context.cookies();
		// const cookieMap = new Map();

		// [...cookiesBefore, ...cookiesAfter].forEach(cookie => {
		// 	cookieMap.set(
		// 		cookie.name,
		// 		cookie
		// 	);

		// });
		// const cookies =[...cookieMap.values()];

		// ---- capture PRE-consent cookies (before clicking Accept) ----
		const preConsentCookies = await context.cookies();
		console.log("Pre-consent cookie count:", preConsentCookies.length);

		// ---- click the consent "Accept" button to unlock tracking cookies ----
		let consentClicked = false;

		// 1) try the detected CMP's own accept selector (from cmps table)
		for (const cmp of CMPs) {
			if (cmp.acceptSelector) {
				try {
					const btn = await page.$(cmp.acceptSelector);
					if (btn) {
						await btn.click();
						consentClicked = true;
						console.log("Accepted via CMP selector:", cmp.acceptSelector);
						break;
					}
				} catch (e) {
					console.log("CMP selector click failed:", e.message);
				}
			}
		}

		// 2) try known ConsentBit selectors (clean CSS — most reliable)
		if (!consentClicked) {
			try {
				const cbBtn = await page.$("#accept-btn, .cb-cookie-accept-btn");
				if (cbBtn) {
					await cbBtn.click();
					consentClicked = true;
					console.log("Accepted via ConsentBit selector");
				}
			} catch (e) {
				console.log("ConsentBit selector click failed:", e.message);
			}
		}

		// 3) fall back to a broad generic accept button
		if (!consentClicked) {
			try {
				const acceptBtn = await page.$(`
					button:has-text("Accept all"),
					button:has-text("Accept All"),
					button:has-text("Accept"),
					button:has-text("Allow all"),
					button:has-text("Allow"),
					button:has-text("I agree"),
					button:has-text("Agree"),
					button:has-text("Got it"),
					button:has-text("OK"),
					a:has-text("Accept all"),
					a:has-text("Accept"),
					[id*="accept"],
					[class*="accept"],
					[aria-label*="accept"]
				`);
				if (acceptBtn) {
					await acceptBtn.click();
					consentClicked = true;
					console.log("Accepted via generic selector");
				} else {
					console.log("No accept button found");
				}
			} catch (e) {
				console.log("Generic accept click failed:", e.message);
			}
		}

		// ---- wait for unlocked tracking scripts to set their cookies ----
		if (consentClicked) {
			await page.waitForTimeout(5000);
		}

		// ---- crawl a few internal pages to collect more cookies (CookieYes-style) ----
		try {
			const origin = new URL(targetUrl).origin;

			// collect same-site links from the homepage (distinct paths, no #/mailto/tel)
			const links = await page.evaluate((origin) => {
				const seen = new Set();
				const out = [];
				for (const a of document.querySelectorAll("a[href]")) {
					const h = a.href;
					if (!h.startsWith(origin)) continue;
					if (h.includes("#") || h.startsWith("mailto:") || h.startsWith("tel:")) continue;
					const path = new URL(h).pathname;
					if (path === "/" || seen.has(path)) continue;
					seen.add(path);
					out.push(h);
				}
				return out.slice(0, 2);   // cap at 2 pages to stay under 60s
			}, origin);

			console.log("Crawling internal pages:", links.length);

			for (const link of links) {
				// stop crawling if we're running low on the 60s budget
				if (timeLeft() < 10000) {
					console.log("Skipping remaining crawl — near 60s deadline");
					break;
				}
				try {
					await page.goto(link, { waitUntil: "domcontentloaded", timeout: 8000 });
					await page.waitForTimeout(1500);   // let that page's tags fire
				} catch (e) {
					console.log("Skip page:", link, e.message);
				}
			}
		} catch (e) {
			console.log("Crawl failed:", e.message);
		}

		// jar cookies (what the browser actually stored — homepage + accepted + crawled pages)
		const jarCookies = await context.cookies();
		console.log("jar cookies",jarCookies.length);
		
		// dedupe by name + domain
		const cookieMap = new Map();
		const keyOf = c => `${c.name.toLowerCase()}|${(c.domain || "").replace(/^\./, "").toLowerCase()}`;

		for (const c of jarCookies) {
		cookieMap.set(keyOf(c), c);
		}

		// add Set-Cookie header cookies the browser may NOT have stored (blocked 3rd-party)
		for (const rc of responseCookies) {
		for (const p of parseSetCookie(rc.setCookie, rc.url)) {
			const key = keyOf(p);
			if (!cookieMap.has(key)) {
			cookieMap.set(key, p);   // only add if not already in the jar
			}
		}
		}

		const cookies = [...cookieMap.values()];
		console.log("Total merged cookies:", cookies.length);
		

		let counts ={necessary: 0, advertisement: 0,analytics: 0, functional: 0, other: 0};

		const cookieRows = await env.cookie_scanner_db
							.prepare(`
								SELECT
								name_or_pattern,
								category,
								is_pattern,
								purpose,
								retention
								FROM cookies
							`)
							.all();

		function matchesPattern(cookieName, pattern) {
			const regexPattern = '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex chars
												.replace(/%/g, '.*')// SQL wildcard
									+ '$';
			return new RegExp(regexPattern, 'i').test(cookieName);
		}

		const dbCookies = cookieRows.results;
		// console.log(dbCookies);
		
		
		const exactCookies = new Map();
		const patternCookies = [];

		for (const row of dbCookies) {
			if (row.is_pattern) {
				patternCookies.push(row);
			}
			else {
				exactCookies.set(
					row.name_or_pattern.toLowerCase(),
					row
				);
			}
		}

		//categorizing the cookies
		for (const cookie of cookies){

			const cookieName = cookie.name.toLowerCase()
			let dbCookie =exactCookies.get(cookieName);


			if (!dbCookie) {
				dbCookie = patternCookies.find(row =>
					matchesPattern(
						cookieName,
						row.name_or_pattern.toLowerCase(),	
					)
				);
			}

			console.log(dbCookie);
			
		
			if(dbCookie){
				//adding description,duration, category to cookie obj
				// cookie.description = dbCookie.purpose || "No description available";
				cookie.duration = dbCookie.retention || "-";
				
				const category = dbCookie.category.toLowerCase();
				cookie.category= category


				if(category.includes("necessary")){
				counts.necessary++
				}
				else if(category.includes("advertising") || category.includes("marketing")){
				counts.advertisement++
				}
				else if(category.includes("analytics")){
				counts.analytics++
				}
				else if(category.includes("functional")){
				counts.functional++
				}
				// else if(category.includes("performance")){
				//   counts.performance++
				// }
				else{
				counts.other++
				}
			}
			else{
				cookie.category='other'
				// cookie.description = "No description available";
				cookie.duration = "-";
				counts.other++
			}
		}
		console.log(counts)
		

		return Response.json(
			{
			totalCookies: cookies.length,
			counts,
			cookies,
			domains: [...requestDomains],
			totalDomains: requestDomains.size,
			trackers: trackerResult.uniqueTrackers,
			domSignal: domSignals,
      		grade:grade
			},
			{
				headers: corsHeaders
			}
		);

    } 
	
	catch(error) {
      return Response.json(
        {
          error: error.message
        },
        {
		  status: 500,
		  headers: corsHeaders
		}
      );
    }

	finally {
		if(browser) {
			try {
				await browser.close();
			} catch(e) {
				console.log("Browser close error:", e);
			}
		}
	}

  }

}
