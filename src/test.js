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
			uniqueTrackers: [...uniqueTrackersMap.values()],
			unknownVendors: undetected            // unmapped domains (name = domain)
		};
	}