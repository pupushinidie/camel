import { useState } from "react";

/** 规则说明：用自己的话写，不照搬原版规则书。 */
function GameRules() {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button
        className="game-rules-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="game-rules-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">✦</span> 游戏规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>

      {open && (
        <div className="game-rules-panel" id="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>
              五只赛驼（红、黄、蓝、绿、紫）绕金字塔跑一圈，你不操控骆驼，只下注。
              任何骆驼越过终点线比赛立即结束，金币最多的人获胜（并列都算赢）。每人开局 3 金。
            </p>
          </div>

          <div className="game-rules-block">
            <h3>轮到你时，四选一（6 人以上五选一）</h3>
            <ol>
              <li><b>掷骰</b>：拿一张金字塔票（赛段结束时 +1 金），从金字塔里随机掷出一颗骰子，对应的骆驼前进 1–3 格。</li>
              <li><b>拿赛段下注票</b>：押这个赛段结束时谁领先。每色票依次是 5、3、2、2，越早拿越值钱。赛段结束时押中第 1 名得票面，第 2 名 +1，其余 −1。</li>
              <li><b>放观众板</b>：放在没有骆驼的格子上（第 1 格不行，不能挨着别人的板）。骆驼停在上面时你 +1 金，欢呼面让它们再进 1 格，嘘面让它们退 1 格并钻到最下面。</li>
              <li><b>终局下注</b>：把一张颜色牌面朝下押在「冠军」或「垫底」。比赛结束时按押的先后翻开，押中的依次得 8、5、3、2、1（之后每人 1），押错 −1。</li>
              <li><b>合伙</b>（6 人以上）：和一位还没结伴的玩家结成本赛段伙伴，赛段结算时额外拿到伙伴最好的一张下注票的收益。</li>
            </ol>
          </div>

          <div className="game-rules-block">
            <h3>骆驼怎么跑</h3>
            <ul>
              <li>骆驼会叠在一起：被骰子选中的骆驼背着上面所有骆驼一起走，落到有骆驼的格子就叠在最上面。同一格里越上面名次越靠前。</li>
              <li>黑、白两只疯骆驼逆着跑，不参与排名也不能押。灰骰决定哪只后退；如果只有一只疯骆驼背着赛驼，就动它；两只叠在一起时动上面那只。</li>
              <li>一个赛段掷完 5 颗骰子就结算，然后下注票、金字塔票、观众板全部收回，骆驼原地不动，开始下一赛段。</li>
            </ul>
          </div>

          <div className="game-rules-block">
            <h3>其他</h3>
            <ul>
              <li>每回合限时 60 秒，超时自动替你掷骰；连续两次超时转托管（人机代打），点「取消托管」收回。掉线时由人机代打，用原昵称和房间码回来就交还座位。</li>
              <li>金币不够付时付到 0 为止。别人押的终局卡颜色在比赛结束前看不到。</li>
            </ul>
            <p className="game-rules-note">骰子全部在服务器上掷，谁也看不到下一颗。</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
