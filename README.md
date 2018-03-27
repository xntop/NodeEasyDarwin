# NodeEasyDarwin

EasyDarwin Node.js 版本 [Demo](http://www.easydarwin.org:10008)

## 安装部署

1. 准备 Node.js 运行环境

    如果你的PC上还没有 Node.js 运行时, 请移步 [Node.js 官网](rtmp://live.hkstv.hk.lxdns.com/live/hks), 安装v8.0以上版本

2. 安装依赖库

        cd NodeEasyDarwin && npm i

## 运行测试

1. 启动流媒体服务

        cd NodeEasyDarwin && npm run start

2. 测试推流

        ffmpeg -i rtmp://live.hkstv.hk.lxdns.com/live/hks -rtsp_transport tcp -vcodec h264 -f rtsp rtsp://www.easydarwin.org/test

3. 测试播放

        ffplay -rtsp_transport tcp rtsp://www.easydarwin.org/test        