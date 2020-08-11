"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_1 = __importStar(require("../../plugin"));
class MainSite extends plugin_1.default {
    constructor() {
        super();
        this.name = '主站功能';
        this.description = '每天自动做主站功能（观看、分享、投币）';
        this.version = '0.0.5';
        this.author = 'Vector000';
    }
    async load({ defaultOptions, whiteList }) {
        defaultOptions.newUserData['main'] = false;
        defaultOptions.newUserData['mainCoin'] = false;
        defaultOptions.newUserData['mainCoinGroup'] = [];
        defaultOptions.info['main'] = {
            description: '主站功能',
            tip: '每天自动完成主站功能（观看、分享、投币[可选]）',
            type: 'boolean'
        };
        defaultOptions.info['mainCoin'] = {
            description: '主站投币',
            tip: '每天自动完成主站投币（不勾选主站功能时此项无效）',
            type: 'boolean'
        };
        defaultOptions.info['mainCoinGroup'] = {
            description: '主站up主',
            tip: '指定UP主的UID为任务、投币对象，以\",\"间隔；若留空，则任务、投币对象为随机选择该用户的关注up主（不勾选主站投币功能时此项无效）',
            type: 'numberArray'
        };
        whiteList.add('main');
        whiteList.add('mainCoin');
        whiteList.add('mainCoinGroup');
        this.loaded = true;
    }
    async start({ users }) {
        this._bilibili(users);
    }
    async loop({ cstMin, cstHour, users }) {
        if (cstMin === 30 && cstHour % 8 === 4)
            this._bilibili(users);
    }
    async _getAttentionList(user) {
        let mids = [];
        const attentions = {
            uri: `https://api.bilibili.com/x/relation/followings?vmid=${user.biliUID}&ps=50&order=desc`,
            jar: user.jar,
            json: true,
            headers: { "Host": "api.bilibili.com" }
        };
        const getAttentions = await plugin_1.tools.XHR(attentions);
        if (getAttentions === undefined)
            return;
        if (getAttentions.response.statusCode !== 200)
            return plugin_1.tools.Log(getAttentions);
        if (getAttentions.body.data.list.length > 0)
            getAttentions.body.data.list.forEach(item => mids.push(item.mid));
        if (user.userData.mainCoinGroup.length > 0)
            mids = user.userData.mainCoinGroup;
        return mids;
    }
    async _getVideoList(mids) {
        let aids = [];
        for (let mid of mids) {
            const summitVideo = {
                uri: `https://space.bilibili.com/ajax/member/getSubmitVideos?mid=${mid}&pagesize=50&tid=0`,
                json: true
            };
            const getSummitVideo = await plugin_1.tools.XHR(summitVideo);
            if (getSummitVideo === undefined || getSummitVideo.response.statusCode !== 200)
                continue;
            else if (getSummitVideo.body.data === undefined || getSummitVideo.body.data === null)
                continue;
            else if (getSummitVideo.body.data.vlist.length === 0)
                continue;
            else
                getSummitVideo.body.data.vlist.forEach(item => { aids.push(item.aid); });
            await plugin_1.tools.Sleep(3 * 1000);
        }
        return aids;
    }
    async _getCid(aid) {
        const cid = {
            uri: `https://www.bilibili.com/widget/getPageList?aid=${aid}`,
            json: true
        };
        const getCid = await plugin_1.tools.XHR(cid);
        if (getCid === undefined)
            return;
        let cids = ({ data: [] });
        cids.data = getCid.body;
        return cids.data[0].cid;
    }
    _bilibili(users) {
        users.forEach(async (user) => {
            if (!user.userData['main'])
                return;
            let mids = await this._getAttentionList(user);
            if (mids === undefined)
                return plugin_1.tools.Log(user.nickname, `获取关注列表失败`);
            if (mids.length === 0)
                return plugin_1.tools.Log(user.nickname, `关注列表空空的哦，去关注几个up主吧~`);
            let aids = await this._getVideoList(mids);
            if (aids.length === 0)
                return plugin_1.tools.Log(user.nickname, `视频列表空空的哦，去关注几个up主吧~`);
            let aid = aids[Math.floor(Math.random() * (aids.length))];
            let cid = (await this._getCid(aid));
            if (cid === undefined)
                return plugin_1.tools.Log(user.nickname, `获取cid失败`);
            const reward = {
                uri: `https://account.bilibili.com/home/reward`,
                jar: user.jar,
                json: true,
                headers: {
                    "Referer": `https://account.bilibili.com/account/home`,
                    "Host": `account.bilibili.com`
                }
            };
            const mainReward = await plugin_1.tools.XHR(reward);
            if (mainReward === undefined)
                return;
            if (mainReward.body.data.watch_av)
                plugin_1.tools.Log(user.nickname, `今天已经看过视频啦~`);
            else
                await this._mainSiteWatch(user, aid, cid);
            if (mainReward.body.data.share_av)
                plugin_1.tools.Log(user.nickname, `今天已经分享过视频啦~`);
            else
                await this._mainSiteShare(user, aid);
            if (user.userData['mainCoin'])
                await this._mainSiteCoin(user, aids, mainReward.body.data.coins_av);
        });
    }
    async _mainSiteWatch(user, aid, cid) {
        let ts = Date.now();
        const heart = {
            method: 'POST',
            uri: `https://api.bilibili.com/x/report/web/heartbeat`,
            body: `aid=${aid}&cid=${cid}&mid=${user.biliUID}&csrf=${plugin_1.tools.getCookie(user.jar, 'bili_jct')}&played_time=3&realtime=3&start_ts=${ts}&type=3&dt=2&play_type=1`,
            jar: user.jar,
            json: true,
            headers: {
                "Host": "api.bilibili.com",
                "Referer": `https://www.bilibili.com/video/av${aid}`
            }
        };
        const avHeart = await plugin_1.tools.XHR(heart);
        if (avHeart !== undefined && avHeart.body.code === 0)
            plugin_1.tools.Log(user.nickname, `已完成主站观看，经验+5`);
        else
            plugin_1.tools.Log(user.nickname, `主站观看失败`);
    }
    async _mainSiteShare(user, aid) {
        let ts = Date.now();
        const share = {
            method: 'POST',
            uri: `https://app.bilibili.com/x/v2/view/share/add`,
            body: plugin_1.AppClient.signQuery(`access_key=${user.accessToken}&aid=${aid}&appkey=${plugin_1.AppClient.appKey}&build=${plugin_1.AppClient.build}&from=7&mobi_app=android&platform=android&ts=${ts}`),
            jar: user.jar,
            json: true,
            headers: { "Host": "app.bilibili.com" }
        };
        const shareAV = await plugin_1.tools.XHR(share, 'Android');
        if (shareAV !== undefined && shareAV.body.code === 0)
            plugin_1.tools.Log(user.nickname, `已完成主站分享，经验+5`);
        else
            plugin_1.tools.Log(user.nickname, `主站分享失败`);
    }
    async _mainSiteCoin(user, aids, coins_av) {
        if (coins_av === 50)
            return plugin_1.tools.Log(user.nickname, `已达到投币上限啦~`);
        const userInfo = {
            uri: `https://account.bilibili.com/home/userInfo`,
            jar: user.jar,
            json: true,
            headers: {
                "Referer": `https://account.bilibili.com/account/home`,
                "Host": `account.bilibili.com`
            }
        };
        const mainUserInfo = await plugin_1.tools.XHR(userInfo);
        if (mainUserInfo === undefined)
            return;
        let coins = mainUserInfo.body.data.coins;
        if (coins === 0)
            return plugin_1.tools.Log(user.nickname, `已经没有硬币啦~`);
        while (coins > 0 && coins_av < 50 && aids.length > 0) {
            let i = Math.floor(Math.random() * (aids.length));
            let aid = aids[i];
            const addCoin = {
                method: 'POST',
                uri: `https://api.bilibili.com/x/web-interface/coin/add`,
                body: `aid=${aid}&multiply=1&cross_domain=true&csrf=${plugin_1.tools.getCookie(user.jar, 'bili_jct')}`,
                jar: user.jar,
                json: true,
                headers: {
                    "Referer": `https://www.bilibili.com/av${aid}`,
                    "Origin": "https://www.bilibili.com",
                    "Host": `api.bilibili.com`
                }
            };
            const coinAdd = await plugin_1.tools.XHR(addCoin);
            if (coinAdd === undefined || coinAdd.body.code === 34005)
                continue;
            if (coinAdd.body.code === 0) {
                coins--;
                coins_av = coins_av + 10;
            }
            aids.splice(i, 1);
            await plugin_1.tools.Sleep(3 * 1000);
        }
        plugin_1.tools.Log(user.nickname, `已完成主站投币，经验+${coins_av}`);
    }
}
exports.default = new MainSite();
