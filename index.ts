import Plugin, { tools, AppClient } from '../../plugin'

class MainSite extends Plugin {
  constructor() {
    super()
  }
  public name = '主站功能'
  public description = '每天自动做主站功能（观看、分享、投币、漫画（签到，分享））'
  public version = '0.0.7'
  public author = 'Vector000'
  public async load({ defaultOptions, whiteList }: { defaultOptions: options, whiteList: Set<string> }) {
    // 自动签到
    defaultOptions.newUserData['main'] = false
    defaultOptions.newUserData['mainCoin'] = false
    defaultOptions.newUserData['mainCoinGroup'] = []
    defaultOptions.info['main'] = {
      description: '主站功能',
      tip: '每天自动完成主站功能（观看、分享、漫画（签到，分享）、投币[可选]）',
      type: 'boolean'
    }
    defaultOptions.info['mainCoin'] = {
      description: '主站投币',
      tip: '每天自动完成主站投币（不勾选主站功能时此项无效）',
      type: 'boolean'
    }
    defaultOptions.info['mainCoinGroup'] = {
      description: '主站up主',
      tip: '指定UP主的UID为任务、投币对象，以\",\"间隔；若留空，则任务、投币对象为随机选择该用户的关注up主（不勾选主站投币功能时此项无效）',
      type: 'numberArray'
    }
    whiteList.add('main')
    whiteList.add('mainCoin')
    whiteList.add('mainCoinGroup')
    this.loaded = true
  }
  public async start({ users }: { users: Map<string, User> }) {
    this._bilibili(users)
  }
  public async loop({ cstMin, cstHour, users }: { cstMin: number, cstHour: number, users: Map<string, User> }) {
    if (cstMin === 30 && cstHour % 8 === 4) this._bilibili(users) // 每天04:30, 12:30, 20:30做主站任务
  }
  /**
   * 获取关注列表
   *
   * @param {User} user
   * @returns {number[]}
   */
  private async _getAttentionList(user: User) {
    let mids: number[] = []
    const attentions: XHRoptions = {
      url: `https://api.bilibili.com/x/relation/followings?vmid=${user.biliUID}&ps=50&order=desc`,
      cookieJar: user.jar,
      responseType: 'json',
      headers: { "Host": "api.bilibili.com" }
    }
    const getAttentions = await tools.XHR<attentions>(attentions)
    if (getAttentions === undefined) return
    if (getAttentions.response.statusCode !== 200) return tools.Log(getAttentions)
    if (getAttentions.body.data.list.length > 0) getAttentions.body.data.list.forEach(item => mids.push(item.mid))
    if ((<number[]>user.userData.mainCoinGroup).length > 0) mids = <number[]>user.userData.mainCoinGroup
    return mids
  }
  /**
   * 获取视频列表
   *
   * @param {number[]} mids
   * @returns {number[]}
   */
  private async _getVideoList(mids: number[]) {
    let aids: number[] = []
    for (let mid of mids) {
      const summitVideo: XHRoptions = {
        url: `https://api.bilibili.com/x/space/arc/search?mid=${mid}&ps=100&tid=0&pn=1&keyword=&order=pubdate&jsonp=jsonp`,
        responseType: 'json'
      }
      const getSummitVideo = await tools.XHR<getSummitVideo>(summitVideo)
      if (getSummitVideo === undefined || getSummitVideo.response.statusCode !== 200) continue
      else if (getSummitVideo.body.data === undefined || getSummitVideo.body.data === null) continue
      else if (getSummitVideo.body.data.list.vlist.length === 0) continue
      else getSummitVideo.body.data.list.vlist.forEach(item => { aids.push(item.aid) })
      await tools.Sleep(3 * 1000)
    }
    return aids
  }
  /**
   * 获取cid(视频av号各p对应唯一值)
   *
   * @param {number} aid
   * @returns {number}
   */
  private async _getCid(aid: number) {
    const cid: XHRoptions = {
      url: `https://api.bilibili.com/x/player/pagelist?aid=${aid}`,
      responseType: 'json'
    }
    const getCid = await tools.XHR<any>(cid)
    if (getCid === undefined) return
    let cids = <getCid>({ data: [] })
    cids.data = <cid[]>getCid.body.data
    return cids.data[0].cid
  }
  /**
   * 主站功能
   *
   * @private
   * @memberof MainSite
   */
  private _bilibili(users: Map<string, User>) {
    users.forEach(async (user) => {
      if (!user.userData['main']) return
      const reward: XHRoptions = {
        url: `https://account.bilibili.com/home/reward`,
        cookieJar: user.jar,
        responseType: 'json',
        headers: {
          "Referer": `https://account.bilibili.com/account/home`,
          "Host": `account.bilibili.com`
        }
      }
      const mainReward = await tools.XHR<mainReward>(reward)
      if (await this._getComicInfo(user)) await this._mainComic(user)
      if (mainReward === undefined) return
      let mids = await this._getAttentionList(user)
      let aids: number[] = []
      if (mids === undefined || mids.length === 0) {
        await (await this._getRankVideo()).forEach(item => aids.push(item.aid))
      } else {
        aids = await this._getVideoList(mids)
      }
      if (aids.length === 0) return tools.Log(user.nickname, `视频列表空空的哦，去关注几个up主吧~`)
      let aid: number = aids[Math.floor(Math.random() * (aids.length))]
      let cid: number = <number>(await this._getCid(aid))
      if (cid === undefined) return tools.Log(user.nickname, `获取cid失败`)
      if (mainReward.body.data.watch_av) tools.Log(user.nickname, `今天已经看过视频啦~`)
      else await this._mainSiteWatch(user, aid, cid)
      if (mainReward.body.data.share_av) tools.Log(user.nickname, `今天已经分享过视频啦~`)
      else await this._mainSiteShare(user, aid)
      if (user.userData['mainCoin']) await this._mainSiteCoin(user, aids, mainReward.body.data.coins_av)
    })
  }
  /**
   * 主站观看
   *
   * @private
   * @memberof MainSite
   */
  private async _mainSiteWatch(user: User, aid: number, cid: number) {
    let ts = Date.now()
    const heart: XHRoptions = {
      method: 'POST',
      url: `https://api.bilibili.com/x/report/web/heartbeat`,
      body: `aid=${aid}&cid=${cid}&mid=${user.biliUID}&csrf=${tools.getCookie(user.jar, 'bili_jct')}&played_time=3&realtime=3&start_ts=${ts}&type=3&dt=2&play_type=1`,
      cookieJar: user.jar,
      responseType: 'json',
      headers: {
        "Host": "api.bilibili.com",
        "Referer": `https://www.bilibili.com/video/av${aid}`
      }
    }
    const avHeart = await tools.XHR<avHeart>(heart)
    if (avHeart !== undefined && avHeart.body.code === 0) tools.Log(user.nickname, `已完成主站观看，经验+5`)
    else tools.Log(user.nickname, `主站观看失败`)
  }
  private async _getRankVideo() {
    const ranking: XHRoptions = {
      method: 'GET',
      url: `https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all`,
      responseType: 'json',
      headers: {
        "Host": "api.bilibili.com",
        "Referer": `https://www.bilibili.com/`
      }
    }
    const rankList = await tools.XHR<rank>(ranking)
    if (rankList !== undefined && rankList.response.statusCode === 200 && rankList.body.code === 0) {
      return rankList.body.data.list
    } else {
      return []
    }
  }
  /**
   * 主站分享
   *
   * @private
   * @memberof MainSite
   */
  private async _mainSiteShare(user: User, aid: number) {
    let ts = Date.now()
    const share: XHRoptions = {
      method: 'POST',
      url: `https://app.bilibili.com/x/v2/view/share/add`,
      body: AppClient.signQuery(`access_key=${user.accessToken}&aid=${aid}&appkey=${AppClient.appKey}&build=${AppClient.build}&from=7&mobi_app=android&platform=android&ts=${ts}`),
      cookieJar: user.jar,
      responseType: 'json',
      headers: { "Host": "app.bilibili.com" }
    }
    const shareAV = await tools.XHR<shareAV>(share, 'Android')
    if (shareAV !== undefined && shareAV.body.code === 0) tools.Log(user.nickname, `已完成主站分享，经验+5`)
    else tools.Log(user.nickname, `主站分享失败`)
  }
  /**
   * 主站投币
   *
   * @private
   * @memberof MainSite
   */
  private async _mainSiteCoin(user: User, aids: number[], coins_av: number) {
    if (coins_av === 50) return tools.Log(user.nickname, `已达到投币上限啦~`)
    const userInfo: XHRoptions = {
      url: `https://account.bilibili.com/site/getCoin`,
      cookieJar: user.jar,
      responseType: 'json',
      headers: {
        "Referer": `https://account.bilibili.com/account/home`,
        "Host": `account.bilibili.com`
      }
    }
    const mainUserInfo = await tools.XHR<mainUserInfo>(userInfo)
    if (mainUserInfo === undefined) return
    let coins = mainUserInfo.body.data.money
    if (coins === 0) return tools.Log(user.nickname, `已经没有硬币啦~`)
    while (coins > 0 && coins_av < 50 && aids.length > 0) {
      let i = Math.floor(Math.random() * (aids.length))
      let aid = aids[i]
      const addCoin: XHRoptions = {
        method: 'POST',
        url: `https://api.bilibili.com/x/web-interface/coin/add`,
        body: `aid=${aid}&multiply=1&select_like=0&cross_domain=true&csrf=${tools.getCookie(user.jar, 'bili_jct')}`,
        cookieJar: user.jar,
        responseType: 'json',
        headers: {
          "Referer": `https://www.bilibili.com/av${aid}`,
          "Origin": "https://www.bilibili.com",
          "Host": `api.bilibili.com`
        }
      }
      const coinAdd = await tools.XHR<coinAdd>(addCoin)
      if (coinAdd === undefined || coinAdd.body.code === 34005) continue
      if (coinAdd.body.code === 0) {
        coins--
        coins_av = coins_av + 10
      }
      aids.splice(i, 1)
      await tools.Sleep(3 * 1000)
    }
    tools.Log(user.nickname, `已完成主站投币，经验+${coins_av}`)
  }
  /**
   * 获取漫画签到信息
   *
   * @private
   * @param user
   * @memberof _getComicInfo
   */
  private async _getComicInfo(user: User) {
    let ts = Date.now()
    const sign: XHRoptions = {
      method: 'POST',
      url: `https://manga.bilibili.com/twirp/activity.v1.Activity/GetClockInInfo`,
      body: AppClient.signQuery(`access_key=${user.accessToken}&platform=android&ts=${ts}`),
      cookieJar: user.jar,
      responseType: 'json'
    }
    const comicInfo = await tools.XHR<comicUserInfo>(sign, 'Android')
    if (comicInfo !== undefined && comicInfo.body.code === 0 && comicInfo.body.data.status === 0) return true
    return false
  }
  /**
   * 漫画签到分享
   *
   * @private
   * @param user
   * @memberof _mainComic
   */
  private async _mainComic(user: User) {
    let ts = Date.now()
    const sign: XHRoptions = {
      method: 'POST',
      url: `https://manga.bilibili.com/twirp/activity.v1.Activity/ClockIn`,
      body: AppClient.signQuery(`access_key=${user.accessToken}&platform=android&ts=${ts}`),
      cookieJar: user.jar,
      responseType: 'json'
    }
    const signComic = await tools.XHR<comicSgin>(sign, 'Android')
    const share: XHRoptions = {
      method: 'POST',
      url: `https://manga.bilibili.com/twirp/activity.v1.Activity/ShareComic`,
      body: AppClient.signQuery(`access_key=${user.accessToken}&platform=android&ts=${ts}`),
      cookieJar: user.jar,
      responseType: 'json'
    }
    const shareComic = await tools.XHR<comicShare>(share, 'Android')
    if (signComic !== undefined && signComic.body.code === 0) tools.Log(user.nickname, `已完成漫画签到`)
    else tools.Log(user.nickname, `漫画签到失败`)
    if (shareComic !== undefined && shareComic.body.code === 0) tools.Log(user.nickname, `已完成漫画签到，经验+${shareComic.body.data.point}`)
    else tools.Log(user.nickname, `漫画分享失败`)
  }
}
/**
 * 主站关注
 *
 * @interface attentions
 */
interface attentions {
  code: number
  data: attentionsData
  message: string
  ttl: number
}
interface attentionsData {
  list: attentionsDataList[]
  reversion: number
  total: number
}
interface attentionsDataList {
  mid: number
  mtime: number
  uname: string
}
/**
 * 主站视频
 *
 * @interface getSummitVideo
 */
interface getSummitVideo {
  status: boolean
  data: getSummitVideoData
}
interface getSummitVideoData {
  page: getgetSummitVideoDataPage
  list: getSummitVideoDataList
}
interface getgetSummitVideoDataPage {
  count: number
  pn: number
  ps: number
}
interface getSummitVideoDataList {
  vlist: getSummitVideoDataListVlist[]
}

interface getSummitVideoDataListVlist {
  aid: number
  created: number
  mid: number
  title: string
}
/**
 * 主站cid
 *
 * @interface getCid
 */
interface getCid {
  data: cid[]
}
interface cid {
  cid: number
}
/**
 * 主站分享返回
 *
 * @interface shareAV
 */
interface shareAV {
  code: number
}
/**
 * 主站心跳
 *
 * @interface avHeart
 */
interface avHeart {
  code: number
}
/**
 * 主站心跳
 *
 * @interface avHeart
 */
interface avHeart {
  code: number
}
/**
 * 主站信息
 *
 * @interface mainUserInfo
 */
interface mainUserInfo {
  code: number
  data: mainUserInfoData
}
interface mainUserInfoData {
  money: number
}
/**
 * 主站任务
 *
 * @interface mainReward
 */
interface mainReward {
  code: number
  data: mainRewardData
}
interface mainRewardData {
  coins_av: number
  login: boolean
  share_av: boolean
  watch_av: boolean
}
/**
 * 投币回调
 *
 * @interface coinAdd
 */
interface coinAdd {
  code: number
}
/**
 * 漫画信息
 *
 * @interface comicUserInfo
 */
interface comicUserInfo {
  code: number
  data: comicUserInfoData
}
interface comicUserInfoData {
  status: number
}
/**
 * 漫画签到
 *
 * @interface
 */
interface comicSgin {
  code: number
}
/**
 * 漫画分享
 *
 * @interface comicShare
 */
interface comicShare {
  code: number
  data: comicShareData
}
interface comicShareData {
  point: number
}
interface rank {
  code: number
  msg: string
  data: rankDate
}
interface rankDate {
  note: string
  list: rankDateList[]
}

interface rankDateList {
  aid: number
  bvid: string
  cid: number
}

export default new MainSite()
