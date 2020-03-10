#!/usr/bin/env node
const express = require('express'); // Express web server framework
const axios = require('axios'); // "Request" library
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const open = require('open');
const util = require('util');
const chalk = require('chalk');
const exec = util.promisify(require('child_process').exec);
require('dotenv').config();
const btoa = require('btoa');
const emoji = require('node-emoji');
const program = require('commander');
const Conf = require('conf');
const config = new Conf();

program
	.option('-i, --clientId <type>', 'Spotify Client ID')
	.option('-s, --clientSecret <type>', 'Spotify Client Secret')
	.option('-c, --clear', 'Clear all stored configs.')
	.parse(process.argv);

if (program.clear) {
	config.clear();
}

if (config.get('clientId') && config.get('clientSecret')) {
	var client_id = config.get('clientId');
	var client_secret = config.get('clientSecret');
} else if (program.clientId && program.clientSecret) {
	config.set('clientId', program.clientId);
	config.set('clientSecret', program.clientSecret);
	var client_id = config.get('clientId');
	var client_secret = config.get('clientSecret');
} else {
	console.log('Enter Spotify --clientID and --clientSecret');
	process.exit(0);
}

var redirect_uri = 'http://localhost:8080/callback'; // Or Your redirect uri

var done = (function wait() {
	if (!done) setTimeout(wait, 1000);
	else process.exit(0);
})();

var generateRandomString = function(length) {
	var text = '';
	var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	for (var i = 0; i < length; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
};

var func = function() {
	const access_token = config.get('access_token'),
		refresh_token = config.get('refresh_token');

	let options = {
		url: 'https://api.spotify.com/v1/me/player/currently-playing',
		headers: {
			Authorization: 'Bearer ' + access_token,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		json: true
	};

	return axios
		.get(options.url, options)
		.then((response) => {
			if (response.data == '') {
				console.log("Seems like you're not playing a Song on Spotify 😒");
				done = true;
			} else {
				gcs(response)
					.then((res) => {
						console.log(res.stdout);
						done = true;
					})
					.catch((err) => {
						console.log(err.stdout);
						done = true;
					});
			}
		})
		.catch((error) => {
			if (error.response && error.response.status == 401) {
				// Token Expired - Refresh token
				axios
					.get('http://localhost:8080/refresh_token?refresh_token=' + refresh_token)
					.then((res) => {
						config.set('access_token', res.data.access_token);
						console.log(chalk.green(chalk.blue.underline.bold('Token refreshed!\n')));
						func();
					})
					.catch((err) => chalk.bold.red(error + 'While getting token from refresh token on Cli'));
			} else {
				console.log(chalk.bold.red(error));
				process.exit(0);
			}
		});
};

var stateKey = 'spotify_auth_state';

var app = express();

app.use(cookieParser());

app.get('/login', function(req, res) {
	var state = generateRandomString(16);
	res.cookie(stateKey, state);
	//Authorization
	var scope = 'user-read-private user-read-email user-read-playback-state';
	res.redirect(
		'https://accounts.spotify.com/authorize?' +
			querystring.stringify({
				response_type: 'code',
				client_id: client_id,
				scope: scope,
				redirect_uri: redirect_uri,
				state: state
			})
	);
});

app.get('/callback', function(req, res) {
	// your application requests refresh and access tokens
	// after checking the state parameter
	var code = req.query.code || null;
	var state = req.query.state || null;
	var storedState = req.cookies ? req.cookies[stateKey] : null;

	if (state === null || state !== storedState) {
		res.redirect(
			'/#' +
				querystring.stringify({
					error: 'state_mismatch'
				})
		);
		console.log(chalk.bold.red('State Mismatch'));
		process.exit(0);
	} else {
		res.clearCookie(stateKey);
		axios
			.post(
				'https://accounts.spotify.com/api/token',
				new URLSearchParams({
					grant_type: 'authorization_code',
					code: code,
					redirect_uri: redirect_uri
				}).toString(),
				{
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						Authorization: 'Basic ' + btoa(client_id + ':' + client_secret).toString('base64')
					}
				}
			)
			.then(function(response) {
				let body = response.data;
				let access_token = body.access_token,
					refresh_token = body.refresh_token;

				config.set('access_token', access_token);
				config.set('refresh_token', refresh_token);

				res.redirect('https://gitcs.now.sh/');
			})
			.catch((err) => console.log(chalk.bold.red(err)));
	}
});

app.get('/refresh_token', function(req, res) {
	// requesting access token from refresh token

	var refresh_token = req.query.refresh_token;

	axios
		.post(
			'https://accounts.spotify.com/api/token',
			new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refresh_token,
				redirect_uri: redirect_uri
			}).toString(),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: 'Basic ' + btoa(client_id + ':' + client_secret).toString('base64')
				}
			}
		)
		.then(function(response) {
			let body = response.data;
			let access_token = body.access_token,
				refresh_token = body.refresh_token;

			res.send({
				access_token: access_token
			});
		})
		.catch((err) => console.log(chalk.bold.red(err)));
});

async function gcs(response) {
	let body = response.data;
	var msg = body.item.name + ' by ' + body.item.artists[0].name + ' ';
	var status = await exec('git commit -m "' + msg + emoji.unemojify(emoji.random().emoji) + '"');
	return status;
}

app.listen(8080);

(async () => {
	if (config.get('access_token') && config.get('refresh_token')) {
		func();
	} else {
		await open('http://localhost:8080/login').then();
	}
})();
