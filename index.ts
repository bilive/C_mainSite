import Plugin, { tools, AppClient } from '../../plugin'

class MainSite extends Plugin {
  constructor() {
    super()
  }
  public name = '主站功能'
  public description = '每天自动做主站功能（观看、分享、投币）'
  public version = '0.0.6'
  public author = 'Vector000, lzghzr'
  public async load({ defaultOptions, whiteList }: { defaultOptions: options, whiteList: Set<string> }) {
    // 自动签到
    defaultOptions.newUserData['main'] = false
    defaultOptions.newUserData['mainCoin'] = false
    defaultOptions.newUserData['mainCoinGroup'] = []
    defaultOptions.info['main'] = {
      description: '主站功能',
      tip: '每天自动完成主站功能（观看、分享、投币[可选]）',
      type: 'boolean'
    }
    defaultOptions.info['mainCoin'] = {
      description: '主站投币',
      tip: '每天自动完成主站投币（不勾选主站功能时此项无效）',
      type: 'boolean'
    }
    defaultOptions.info['mainCoinGroup'] = {
      description: '主站up主',
      tip: '指定UP主的UID为任务、投币对象，以\',\'间隔；若留空，则任务、投币对象为随机选择该用户的关注up主（不勾选主站投币功能时此项无效）',
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
   * @private
   * @param {User} user
   * @returns {(Promise<number[] | void>)}
   * @memberof MainSite
   */
  private async _getAttentionList(user: User): Promise<number[] | void> {
    let mids: number[] = []
    const attentions: XHRoptions = {
      uri: `https://api.bilibili.com/x/relation/followings?vmid=${user.biliUID}&ps=50&order=desc`,
      jar: user.jar,
      json: true,
      headers: { 'Host': 'api.bilibili.com' }
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
   * @private
   * @param {number[]} mids
   * @returns {Promise<number[]>}
   * @memberof MainSite
   */
  private async _getVideoList(mids: number[]): Promise<number[]> {
    let aids: number[] = []
    for (let mid of mids) {
      const summitVideo: XHRoptions = {
        uri: `https://api.bilibili.com/x/space/arc/search?mid=${mid}&ps=100&tid=0&pn=1&keyword=&order=pubdate`,
        json: true
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
   * @returns {(Promise<number | void>)}
   */
  private async _getCid(aid: number): Promise<number | void> {
    const cid: XHRoptions = {
      uri: `https://www.bilibili.com/widget/getPageList?aid=${aid}`,
      json: true
    }
    const getCid = await tools.XHR<getCid[]>(cid)
    if (getCid === undefined || getCid.response.statusCode !== 200) return
    return getCid.body[0].cid
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
      let mids = await this._getAttentionList(user)
      if (mids === undefined) return tools.Log(user.nickname, `获取关注列表失败`)
      if (mids.length === 0) return tools.Log(user.nickname, `关注列表空空的哦，去关注几个up主吧~`)
      let aids = await this._getVideoList(mids)
      if (aids.length === 0) return tools.Log(user.nickname, `视频列表空空的哦，去关注几个up主吧~`)
      let aid: number = aids[Math.floor(Math.random() * (aids.length))]
      let cid: number = <number>(await this._getCid(aid))
      if (cid === undefined) return tools.Log(user.nickname, `获取cid失败`)
      const reward: XHRoptions = {
        uri: `https://account.bilibili.com/home/reward`,
        jar: user.jar,
        json: true,
        headers: {
          'Referer': `https://account.bilibili.com/account/home`,
          'Host': `account.bilibili.com`
        }
      }
      const mainReward = await tools.XHR<mainReward>(reward)
      if (mainReward === undefined) return
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
      uri: `https://api.bilibili.com/x/report/web/heartbeat`,
      body: `aid=${aid}&cid=${cid}&mid=${user.biliUID}&csrf=${tools.getCookie(user.jar, 'bili_jct')}&played_time=3&realtime=3&start_ts=${ts}&type=3&dt=2&play_type=1`,
      jar: user.jar,
      json: true,
      headers: {
        'Host': 'api.bilibili.com',
        'Referer': `https://www.bilibili.com/video/av${aid}`
      }
    }
    const avHeart = await tools.XHR<avHeart>(heart)
    if (avHeart !== undefined && avHeart.body.code === 0) tools.Log(user.nickname, `已完成主站观看，经验+5`)
    else tools.Log(user.nickname, `主站观看失败`)
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
      uri: `https://app.bilibili.com/x/v2/view/share/add`,
      body: AppClient.signQuery(`access_key=${user.accessToken}&aid=${aid}&appkey=${AppClient.appKey}&build=${AppClient.build}&from=7&mobi_app=android&platform=android&ts=${ts}`),
      jar: user.jar,
      json: true,
      headers: { 'Host': 'app.bilibili.com' }
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
      uri: `https://account.bilibili.com/home/userInfo`,
      jar: user.jar,
      json: true,
      headers: {
        'Referer': `https://account.bilibili.com/account/home`,
        'Host': `account.bilibili.com`
      }
    }
    const mainUserInfo = await tools.XHR<mainUserInfo>(userInfo)
    if (mainUserInfo === undefined) return
    let coins = mainUserInfo.body.data.coins
    if (coins === 0) return tools.Log(user.nickname, `已经没有硬币啦~`)
    while (coins > 0 && coins_av < 50 && aids.length > 0) {
      let i = Math.floor(Math.random() * (aids.length))
      let aid = aids[i]
      const addCoin: XHRoptions = {
        method: 'POST',
        uri: `https://api.bilibili.com/x/web-interface/coin/add`,
        body: `aid=${aid}&multiply=1&cross_domain=true&csrf=${tools.getCookie(user.jar, 'bili_jct')}`,
        jar: user.jar,
        json: true,
        headers: {
          'Referer': `https://www.bilibili.com/av${aid}`,
          'Origin': 'https://www.bilibili.com',
          'Host': `api.bilibili.com`
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
  code: number
  message: string
  ttl: number
  data: getSummitVideoData
}
interface getSummitVideoData {
  list: getSummitVideoDataList
  page: getSummitVideoDataPage
}
interface getSummitVideoDataList {
  tlist: { [key: string]: getSummitVideoDataListTlist }
  vlist: getSummitVideoDataListgetSummitVideo[]
}
interface getSummitVideoDataListTlist {
  tid: number
  count: number
  name: string
}
interface getSummitVideoDataListgetSummitVideo {
  comment: number
  typeid: number
  play: number
  pic: string
  subtitle: string
  description: string
  copyright: string
  title: string
  review: number
  author: string
  mid: number
  created: number
  length: string
  video_review: number
  aid: number
  bvid: string
  hide_click: boolean
  is_pay: number
  is_union_video: number
}
interface getSummitVideoDataPage {
  count: number
  pn: number
  ps: number
}
/**
 * 主站cid
 *
 * @interface getCid
 */
interface getCid {
  page: number
  pagename: string
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
  coins: number
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
export default new MainSite()