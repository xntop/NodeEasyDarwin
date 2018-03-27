const net = require('net');
const event = require('events');
const shortid = require('shortid');
const url = require('url');
const path = require('path');
const rtpParser = require('rtp-parser');
const BufferPool = require('buffer-pool');
const sdpParser = require('sdp-transform');

class RTSPRequest {
    constructor() {
        this.method = '';
        this.url = '';
        this.raw = '';
    }
}

class RTSPSession extends event.EventEmitter {

    constructor(socket, server) {
        super();
        this.type = '';
        this.url = '';
        this.path = '';
        this.acontrol = '';
        this.vcontrol = '';
        this.sid = shortid.generate();
        this.socket = socket;
        this.server = server;
        this.bp = new BufferPool(this.genHandleData());
        this.bp.init();
        this.gopCache = [];
        this.inBytes = 0;
        this.outBytes = 0;
        this.startAt = new Date();
        this.socket.on("data", data => {
            this.bp.push(data);
        }).on("close", () => {
            this.stop();
            console.log(`rtsp session[type=${this.type}, path=${this.path}, sid=${this.sid}] end`);
        }).on("error", err => {
            // console.log(err);
        })

        this.on("request", this.handleRequest);
    }

    * genHandleData() {
        while (true) {
            if (this.bp.need(1)) {
                if (yield) return;
            }
            var buf = this.bp.read(1);
            if (buf.readUInt8() == 0x24) { // rtp
                if (this.bp.need(3)) {
                    if (yield) return;
                }
                buf = this.bp.read(3);
                var channel = buf.readUInt8();
                var rtpLen = buf.readUInt16BE(1);
                if (this.bp.need(rtpLen)) {
                    if (yield) return;
                }
                var rtpBody = this.bp.read(rtpLen);
                var rtpBuf = Buffer.allocUnsafe(rtpLen + 4);
                rtpBuf.writeUInt8(0x24);
                buf.copy(rtpBuf, 1, 0);
                rtpBody.copy(rtpBuf, 4, 0);

                if (channel == this.vrtpchannel && this.vcodec.toUpperCase() == 'H264') {
                    var rtp = rtpParser.parseRtpPacket(rtpBody);
                    if (rtpParser.isKeyframeStart(rtp.payload)) {
                        // console.log(`find key frame, current gop cache size[${this.gopCache.length}]`);
                        this.gopCache = [];
                    }
                    this.gopCache.push(rtpBuf);
                }
                this.inBytes += rtpBuf.length;
                this.broadcast(rtpBuf);
            } else { // rtsp method
                var reqBuf = Buffer.concat([buf], 1);
                while (reqBuf.toString().indexOf("\r\n\r\n") < 0) {
                    if (this.bp.need(1)) {
                        if (yield) return;
                    }
                    buf = this.bp.read(1);
                    reqBuf = Buffer.concat([reqBuf, buf], reqBuf.length + 1);
                }
                var req = this.parseRequestHeader(reqBuf.toString());
                if (req['Content-Length']) {
                    var bodyLen = parseInt(req['Content-Length']);
                    if (this.bp.need(bodyLen)) {
                        if (yield) return;
                    }
                    buf = this.bp.read(bodyLen);
                    var bodyRaw = buf.toString();
                    if (req.method.toUpperCase() == 'ANNOUNCE' || req.method.toUpperCase() == 'DESCRIBE') {
                        this.sdp = sdpParser.parse(bodyRaw);
                        // console.log(JSON.stringify(this.sdp, null, 1));
                        this.sdpRaw = bodyRaw;
                        if(this.sdp && this.sdp.media && this.sdp.media.length > 0) {
                            for(var media of this.sdp.media) {
                                if(media.type == 'video') {
                                    this.vcontrol = media.control;
                                    if(media.rtp && media.rtp.length > 0) {
                                        this.vcodec = media.rtp[0].codec;
                                        this.vrate = media.rtp[0].rate;
                                        this.vpayload = media.rtp[0].payload;
                                    }
                                }
                                if(media.type == 'audio') {
                                    this.acontrol = media.control;
                                    if(media.rtp && media.rtp.length > 0) {
                                        this.acodec = media.rtp[0].codec;
                                        this.arate = media.rtp[0].rate;
                                        this.apayload = media.rtp[0].payload;
                                    }
                                }
                            }
                        }
                    }
                    req.raw += bodyRaw;
                }
                this.emit('request', req);
            }
        }

    }

    /**
     * 
     * @param {Object} opt 
     * @param {Number} [opt.code=200]
     * @param {String} [opt.msg='OK']
     * @param {Object} [opt.headers={}]
     */
    makeResponseAndSend(opt = {}) {
        var def = { code: 200, msg: 'OK', headers: {} };
        var opt = Object.assign({}, def, opt);
        var raw = `RTSP/1.0 ${opt.code} ${opt.msg}\r\n`;
        for (var key in opt.headers) {
            raw += `${key}: ${opt.headers[key]}\r\n`;
        }
        raw += `\r\n`;
        // console.log(`>>>>>>>>>>>>> response[${opt.method}] >>>>>>>>>>>>>`);
        // console.log(raw);
        this.socket.write(raw);
        if (opt.body) {
            // console.log(new String(opt.body).toString());
            this.socket.write(opt.body);
        }
        return raw;
    }

    parseRequestHeader(header = '') {
        var ret = new RTSPRequest();
        ret.raw = header;
        var lines = header.trim().split("\r\n");
        if (lines.length == 0) {
            return ret;
        }
        var line = lines[0];
        var items = line.split(/\s+/);
        ret.method = items[0];
        ret.url = items[1];
        for (var i = 1; i < lines.length; i++) {
            line = lines[i];
            items = line.split(/:\s+/);
            ret[items[0]] = items[1];
        }
        return ret;
    }

    /**
     * 
     * @param {RTSPRequest} req 
     */
    handleRequest(req) {
        // console.log(`<<<<<<<<<<< request[${req.method}] <<<<<<<<<<<<<`);
        // console.log(req.raw);
        var res = {
            method: req.method,
            headers: {
                CSeq: req['CSeq'],
                Session: this.sid
            }
        };
        switch (req.method) {
            case 'OPTIONS':
                res.headers['Public'] = "DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE, OPTIONS, ANNOUNCE, RECORD";
                break;
            case 'ANNOUNCE':
                this.type = 'pusher';
                this.url = req.url;
                this.path = url.parse(this.url).path;
                var pushSession = this.server.pushSessions[this.path];
                if(pushSession) {
                    res.code = 406;
                    res.msg = 'Not Acceptable';
                } else {
                    this.server.addSession(this);
                }
                break;
            case 'SETUP':
                var ts = req['Transport'] || "";
                var matches = ts.match(/interleaved=(\d+)(-(\d+))?/);
                var control = req.url.substring(req.url.lastIndexOf('/') + 1);
                if(control == this.vcontrol && matches) {
                    this.vrtpchannel = matches[1];
                    this.vrtcpchannel = matches[3];
                }
                if(control == this.acontrol && matches) {
                    this.artpchannel = matches[1];
                    this.artcpchannel = matches[3];
                }
                res.headers['Transport'] = ts;
                break;
            case 'DESCRIBE':
                this.type = 'player';
                this.url = req.url;
                this.path = url.parse(this.url).path;
                var pushSession = this.server.pushSessions[this.path];
                if (pushSession && pushSession.sdpRaw) {
                    res.headers['Content-Length'] = pushSession.sdpRaw.length;
                    res.body = pushSession.sdpRaw;
                } else {
                    res.code = 404;
                    res.msg = 'NOT FOUND';
                }
                break;
            case 'PLAY':
                process.nextTick(() => {
                    var pushSession = this.server.pushSessions[this.path];
                    if (pushSession && pushSession.gopCache) {
                        // console.log(`first send gop cache size[${pushSession.gopCache.length}]`);
                        for (var gop of pushSession.gopCache) {
                            this.socket.write(gop);
                        }
                    }
                    this.server.addSession(this);
                })
                res.headers['Range'] = req['Range'];
                break;
            case 'TEARDOWN':
                this.makeResponseAndSend(res);
                this.socket.end();
                return;
        }
        this.makeResponseAndSend(res);
    }

    stop() {
        this.bp.stop();
        this.server.removeSession(this);
    }

    broadcast(rtpBuf) {
        var playSessions = this.server.playSessions[this.path] || [];
        for (var playSession of playSessions) {
            playSession.outBytes += rtpBuf.length;
            this.outBytes += rtpBuf.length;
            playSession.socket.write(rtpBuf);
        }
    }
}

module.exports = RTSPSession;