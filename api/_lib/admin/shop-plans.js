/*
 * Shop admin API: instalment plans (rules in api/_lib/shop/instalments.js; docs/commerce-plan.md section 14).
 * Page: /admin/shop/orders/ (the "Instalment plan" block of an instalment order).
 */
const instalments = require('../shop/instalments.js');
const manual = require('../shop/manual.js');
const { userError, text, int } = require('./util.js');

const id = (value, label) => int(value, { min: 1, max: 2147483647, label });

const asUserError = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof instalments.PlanError || err instanceof manual.ManualError) throw userError(err.message);
    if (err && err.code === 'not_configured') throw userError(err.message, 503);
    throw err;
  }
};

const actions = {
  async 'shop-plan-pause'(input, { admin }) {
    const order = await asUserError(() => instalments.pause(id(input.order, 'order'), { by: admin }));
    return { order: { id: order.id, plan_status: order.plan_status }, target: `order ${order.number}`, log: { order: order.number } };
  },

  async 'shop-plan-resume'(input, { admin }) {
    const order = await asUserError(() => instalments.resume(id(input.order, 'order'), { by: admin }));
    return { order: { id: order.id, plan_status: order.plan_status }, target: `order ${order.number}`, log: { order: order.number } };
  },

  // `force`: stop it here although CiderPay refused or didn't answer (after checking CiderPay's dashboard).
  async 'shop-plan-stop'(input, { admin }) {
    const reason = text(input.reason, { max: 300, label: 'Reason' });
    const force = input.force === true || input.force === 'true';
    const r = await asUserError(() => instalments.stop(id(input.order, 'order'), { by: admin, reason, force }));
    return {
      order: { id: r.order.id, plan_status: r.order.plan_status }, endedAtCiderpay: r.endedAtCiderpay,
      target: `order ${r.order.number}`, log: { order: r.order.number, reason, force, ended_at_ciderpay: r.endedAtCiderpay },
    };
  },

  // A payment link for one instalment: the customer pays it by card; CiderPay's notice records it.
  async 'shop-instalment-link'(input, { admin }) {
    const number = int(input.number, { min: 2, max: 30, label: 'instalment' });
    const order = id(input.order, 'order');
    const link = await asUserError(() => instalments.makeLink(order, number, { by: admin }));
    return { link, target: `order ${order}`, log: { order, instalment: number, last_day: link.last_day } };
  },

  // An instalment paid another way (bank transfer…): recorded by hand with the day the money came in.
  async 'shop-instalment-paid'(input, { admin }) {
    const number = int(input.number, { min: 2, max: 30, label: 'instalment' });
    const details = await asUserError(async () => manual.paidDetails(input));
    const order = await asUserError(() => instalments.settleByHand(id(input.order, 'order'), number, { ...details, by: admin }));
    return { order: { id: order.id, plan_status: order.plan_status }, target: `order ${order.number}`, log: { order: order.number, instalment: number, method: details.method, reference: details.reference } };
  },
};

module.exports = { section: 'shop', actions, writes: Object.keys(actions) };
