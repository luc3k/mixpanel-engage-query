#!/usr/bin/env node

/*jshint node: true */

"use strict";

var needle      = require('needle'),
    crypto      = require('crypto'),

    // mixpanel
    base_url    = "http://mixpanel.com/api/2.0/",

    // according to mixpanel doc https://mixpanel.com/docs/api-documentation/data-export-api#engage-default
    // response should return page_size, but it doesn't, so we assume it is 1000 for now
    page_size = 1000;

// options
var argv = require('optimist')
    .usage('Usage: $0 -k [string] -s [string]')
    .demand(['k', 's'])
    .options('k', {
        alias: 'key',
        describe: 'MixPanel API key'
    })
    .options('s', {
        alias: 'secret',
        describe: 'MixPanel API secret'
    })
    .options('q', {
        alias: 'query',
        // https://mixpanel.com/docs/api-documentation/data-export-api#segmentation-expressions
        // example: 'properties["$last_seen"] > "2013-08-29T23:00:00"'
        describe: 'A segmentation expression (see MixPanel API doc)'
    })
    .options('f', {
        alias: 'format',
        default: 'json',
        describe: 'Output format, json or csv'
    })
    .options('p', {
        alias: 'properties',
        describe: "Properties to output (e.g. '$email $first_name'). Outputs all properties if none specified."
    })
    .options('r', {
        alias: 'required',
        describe: "Skip entries where the required properties are not set (e.g. '$email $first_name')."
    })
    .options('i', {
        alias: 'iosifa',
		default: 'no',
        describe: "Run ios_ifa comparision if set yo yes, default no."
    })
    .options('m', {
        alias: 'mixpanel',
        describe: "MixPanel token"
    })
    .argv;

// get properties to output
var properties = typeof argv.properties === "string" ? argv.properties.split(" ") : [];

// get required properties
var required = typeof argv.required === "string" ? argv.required.split(" ") : [];

// entires

var entries = [];

// do the stuff!
queryEngageApi({
    page: 0,
    where: argv.query || ""
});

// ------------------------------------------

function queryEngageApi(params) {
    var url = getUrl("engage", params);

    needle.get(url, {}, function(err, resp, data) {
        // request error
        if (err) {
            console.log("Error: " + err);
            return;
        }

        // MixPanel API error
        if (data.error) {
            console.log('MixPanel API error: ' + data.error);
            return;
        }

        processResults(data);

        // unless fewer results than page_size, keep querying for additional pages
        if (data.results.length >= page_size) {
            // get next page
            params.page++;
            // use session id in next query to speed up api response
            params.session_id = data.session_id;

            queryEngageApi(params);
        } else {
        	if (argv.iosifa === "yes") {
				var i, n, entry, len2, len = entries.length;
				var entries_d_i = [];
				var entries_d = [];
				var entries_t_a = [];
				for (i = 0; i < len; i ++) {
					entry = entries[i];
					if (entry.$distinct_id.length > 0 && entry.$ios_ifa.length > 0) {
						entries_d_i.push(entry);
					} else {
						entries_d.push(entry);
					}
				}
				len = entries_d.length;
				len2 = entries_d_i.length;
				for (i = 0; i < len; i ++) {
					for (n = 0; n < len2; n ++) {
						if (entries_d[i].$distinct_id === entries_d_i[n].$ios_ifa) {
							var entry_temp = {};
							entry_temp.alias = entries_d_i[n].$distinct_id;
							entry_temp.distinct_id = entries_d[i].$distinct_id;
							if (entries_d_i[n].role == 'parent') {
								entries_t_a.push(entry_temp);
							}
						}
					}
				}
				if (argv.mixpanel !== 'undefined') {
					if (argv.mixpanel.length !== 0) {
						var Mixpanel = require('mixpanel');
						var mixpanel = Mixpanel.init(argv.mixpanel);
						len = entries_t_a.length;
						for (i = 0; i < len; i ++) {
							console.log(entries_t_a[i].alias + ' ' + entries_t_a[i].distinct_id);
							mixpanel.alias(entries_t_a[i].distinct_id, entries_t_a[i].alias);
						}
					}
				}
			}
        }
    });
}

function processResults(data) {
    var i, csv, entry, len = data.results.length;

    for (i = 0; i < len; i++) {
        if (required.length > 0) {
            // skip if not required properties present
            if (!required.every(function(r) {
                return typeof data.results[i].$properties[r] !== 'undefined';
            })) {
                continue;
            }
        }

        entry = {};
        if (properties.length === 0) {
            // output all
            entry = data.results[i].$properties;
			entry['$distinct_id'] = data.results[i].$distinct_id;
        } else {
            // only include given properties
            properties.forEach(function(p) {
				if (p == '$distinct_id') {
					entry['$distinct_id'] = data.results[i].$distinct_id;					
				} else {
					entry[p] = data.results[i].$properties[p] || '';
				}
            });
        }
		
		if (argv.iosifa === "yes") {
			if (data.results[i].$properties['Role'] == 'parent') {
				entry['role'] = data.results[i].$properties['Role'];
			}
		}
		entries.push(entry);

        // skip if object is empty
        if (Object.keys(entry).length === 0) {
            continue;
        }

        if (argv.format === "csv") {
            // csv
            csv = [];
            Object.keys(entry).forEach(function(k) {
                csv.push(entry[k]);
            });
			if (argv.iosifa === "no") {
				console.log(csv.join(";"));
			}
        } else {
            // json
			if (argv.iosifa === "no") {
            	console.log(JSON.stringify(entry));
			}
        }
    }
}

function getUrl(endpoint, args) {
    // add api_key and 60 sec expire
    args.api_key = argv.key;
    args.expire = Math.round(Date.now() / 1000) + 60;

    // see https://mixpanel.com/docs/api-documentation/data-export-api#auth-implementation
    var arg_keys = Object.keys(args),
        sorted_keys = arg_keys.sort(),
        concat_keys = "",
        params = [];

    for (var i = 0; i < sorted_keys.length; i++) {
        params.push(sorted_keys[i] + "=" + args[sorted_keys[i]]);
        concat_keys += params[params.length - 1];
    }

    // sign
    var sig = crypto.createHash('md5').update(concat_keys + argv.secret).digest("hex");

    // return request url
    return base_url + endpoint + "/?" + params.join("&") + "&sig=" + sig;
}