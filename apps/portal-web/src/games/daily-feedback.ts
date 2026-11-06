import { RULES, cashDeck, type StampState, type CashState } from './domain';

// Action feedback reads settled facts only. Clocks and renderer frames never
// announce progress, and a failed capture does not consume a photo.
export function photoNotice(message: string, client: number, film: number): string {
    return `${message} 第 ${client + 1} / ${RULES.clients} 位客人，已保存 ${film} / ${RULES.film} 張，還可拍 ${RULES.film - film} 張。`;
}
export function stampNotice(state: StampState, kind: 'hit' | 'miss' | 'practice'): string {
    if (kind === 'practice') return '練習完成。十二張正式公文，開始！';
    const message = kind === 'hit' ? '啪！已閱，但看不懂。' : '章歪了。墨跡留下，這張再蓋一次。';
    return state.practice ? `${message} 練習失手 ${state.misses} 次，不計入正式文件。` : `${message} 已完成 ${state.index} / ${RULES.documents} 份 · 多蓋 ${state.misses} 次。`;
}
export function cashNotice(state: CashState, kind: 'correct' | 'wrong', accept: boolean): string {
    const message = kind === 'wrong' ? '這張分錯了，退回來重新看看。' : accept ? '道具鈔收到。財富看起來很有希望。' : '這張不是錢，老闆先收回去。';
    return `${message} 已分類 ${state.index} / ${cashDeck(state.seed).length} 張 · 分錯 ${state.mistakes} 次。`;
}
