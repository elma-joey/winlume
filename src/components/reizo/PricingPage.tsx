import Link from "next/link";
import ReizoHeader from "./ReizoHeader";
import ReizoFooter from "./ReizoFooter";
import { ModelCatalog } from "./ApiPage";

const plans = [
  {id:"core",name:"Core",label:"基础",price:29,credits:"10,000",discount:"9.75"},
  {id:"plus",name:"Plus",label:"进阶",price:69,credits:"25,000",discount:"9.5"},
  {id:"pro",name:"Pro",label:"专业",price:129,credits:"45,000",discount:"9.25"},
  {id:"max",name:"Max",label:"旗舰",price:229,credits:"80,000",discount:"9"},
];

export default function PricingPage() {
  return <div className="reizo-site reizo-page-pricing pricing-page"><ReizoHeader /><main id="main">
    <section className="pricing-first shell"><div className="reizo-pricing-heading"><p className="eyebrow">会员与价格</p><h1>按量购买，<br />按你的节奏使用。</h1><p>先从一件事开始。工作台与 API 共用账户余额，使用情况清楚可查。</p></div>
      <section className="payg-strip"><div><p className="eyebrow">灵活使用</p><h2 id="payg-title">直接购买额度</h2><p>无需订阅月费，按实际调用量结算。充值金额与支付方式以钱包显示为准。</p></div><Link className="button" href="/account/wallet">前往钱包充值 <span>↗</span></Link></section>

      <div className="plans-caption"><h2>选择适合你的会员</h2><span>人民币 · 月付</span></div>
      <div className="plans-grid">
        {plans.map(plan => <article className={`plan-card${plan.id === "pro" ? " plan-featured" : ""}`} aria-labelledby={`plan-${plan.id}`} key={plan.id}>
          <div className="plan-name"><h3 id={`plan-${plan.id}`}>{plan.name} <span>{plan.label}</span></h3>{plan.id === "pro" && <span className="plan-tag">高频之选</span>}</div>

          <p className="plan-price"><span>¥</span>{plan.price}<small>/ 月</small></p>
          <Link href="/account/pricing" className="button plan-button">选择 {plan.name}<span aria-hidden="true">↗</span></Link>
          <div className="plan-allocation"><strong>{plan.credits}</strong><span>额度 / 月</span></div>
          <p className="allocation-note">当前订阅月有效，未用完不结转</p>
          <div className="plan-extra"><div className="plan-discount"><span>额外购买额度</span><strong>{plan.discount} 折</strong></div></div>
          <p className="plan-validity">另购额度长期有效。<br />套餐到期后，额外充值恢复标准价格。</p>
        </article>)}
      </div>
      <div className="pricing-fineprint"><p>额度单位为 Credits，非 Token；¥1 = 300 额度；套餐有效期一个月，手动续购。</p><a href="#rules">查看完整规则 ↓</a></div>
    </section>
    <ModelCatalog />
    <section className="pricing-faq shell" id="rules"><h2>常见问题</h2>{[["必须购买会员才能使用吗？", "不需要。可以通过账户钱包充值余额，按实际用量使用工作台和 API。"], ["模型费用如何计算？", "不同模型采用不同计费方式。目录显示当前公开费率；实际费用取决于模型、参数和你的账户分组，可以在用量记录中核对。"], ["工作台和 API 是否共用余额？", "使用同一账户的余额与账单。会员权益是否适用，以账户中心显示的已开通权益为准。"], ["在哪里查看充值和调用记录？", "进入账户中心的钱包与账单、用量明细和调用日志，即可查看对应记录。"]].map(([question, answer]) => <details key={question}><summary>{question}<span>＋</span></summary><p>{answer}</p></details>)}</section>
    <section className="pricing-ending shell"><h2>先开始，再选适合的用量。</h2><Link className="button" href="/studio">开始使用 REIZO <span>↗</span></Link></section>
  </main><ReizoFooter /></div>;
}
