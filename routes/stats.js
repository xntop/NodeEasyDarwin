const express = require("express");
const escapeReg = require('escape-string-regexp');
const utils = require("utils");
const cfg = require("cfg");
const moment = require('moment');

const r = express.Router();

r.post('/pushers', async(req, res) => {
    if(!r.rtspServer) {
        res.json({
            total: 0,
            rows: []
        })
    }
    var pushers = [];
    var start = parseInt(req.body.start) || 0;
    var limit = parseInt(req.body.limit) || 10;
    var q = req.body.q || "";
    var sort = req.body.sort;
    var order = req.body.order;
    for(var path in r.rtspServer.pushSessions) {
        var pusher = r.rtspServer.pushSessions[path];
        pushers.push({
            id: pusher.sid,
            path: pusher.path,
            inBytes: pusher.inBytes,
            outBytes: pusher.outBytes,
            startAt: moment(pusher.startAt).format('YYYY-MM-DD HH:mm:ss'),
            onlines: (r.rtspServer.playSessions[path]||[]).length
        })
    }
    if(sort) {
        pushers.sort((a, b) => {
            return new String(a[sort]).localeCompare(new String(b[sort])) * (order == 'ascending' ? 1 : -1);
        })
    }
    if(q) {
        pushers = pushers.filter(v => {
            var exp = new RegExp(escapeReg(q));
            return exp.test(v.path) || exp.test(v.id);
        })
    }
    res.json({
        total: pushers.length,
        rows: pushers.slice(start, start + limit)
    })
})

r.post('/players', async(req, res) => {
    if(!r.rtspServer) {
        res.json({
            total: 0,
            rows: []
        })
    }
    var players = [];
    var start = parseInt(req.body.start) || 0;
    var limit = parseInt(req.body.limit) || 10;
    var q = req.body.q || "";
    var sort = req.body.sort;
    var order = req.body.order;
    for(var path in r.rtspServer.playSessions) {
        var _players = r.rtspServer.playSessions[path]||[];
        _players = _players.map(player => {
            return {
                id: player.sid,
                path: player.path,
                inBytes: player.inBytes,
                outBytes: player.outBytes,
                startAt: moment(player.startAt).format('YYYY-MM-DD HH:mm:ss')
            }
        });
        players = players.concat(_players);
    }
    if(sort) {
        players.sort((a, b) => {
            return new String(a[sort]).localeCompare(new String(b[sort])) * (order == 'ascending' ? 1 : -1);
        })
    }
    if(q) {
        players = players.filter(v => {
            var exp = new RegExp(escapeReg(q));
            return exp.test(v.path) || exp.test(v.id);
        })
    }
    res.json({
        total: players.length,
        rows: players.slice(start, start + limit)
    })    
})

module.exports = r;