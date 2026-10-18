import {useEffect, useState} from 'react';
import {useLanguage} from '../../language';
import {PROMO_LIMITS, PROMO_RATIOS, PromoError, initialPromoDocument, type PromoDocument, type PromoField, type PromoRatio} from './model';
import {promoText, type PromoMessage} from './messages';
import type {PromoPng} from './render';
import './preview.css';

type PreparedImage = PromoPng & {key: string; url: string};
const fieldLabels: Record<PromoField, PromoMessage> = {label: 'label', title: 'headline', body: 'body', footer: 'footer'};

/** Development preview only. The production Portal never imports this component. */
export function PromotionalPreview() {
  const {language} = useLanguage();
  const t = (key: PromoMessage, values?: Record<string, string>) => promoText(language, key, values);
  const [design, setDesign] = useState<PromoDocument>(initialPromoDocument);
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [fault, setFault] = useState<PromoError | null>(null);
  const [attempt, setAttempt] = useState(0), [downloadedKey, setDownloadedKey] = useState('');
  const key = JSON.stringify(design);
  const ready = prepared?.key === key ? prepared : null;
  useEffect(() => {
    let current = true, url: string | undefined;
    setPrepared(null); setFault(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const {renderPromoPng} = await import('./render');
          const output = await renderPromoPng(JSON.parse(key), 'page-1');
          if (!current) return;
          url = URL.createObjectURL(output.blob);
          setPrepared({...output, url, key});
        } catch (cause) {
          if (current) setFault(cause instanceof PromoError ? cause : new PromoError('canvas'));
        }
      })();
    }, 150);
    return () => {current = false; clearTimeout(timer); if (url) URL.revokeObjectURL(url);};
  }, [key, attempt]);
  const change = (field: PromoField, value: string) => setDesign(current => ({
    ...current, pages: current.pages.map(page => ({...page, [field]: value})),
  }));
  const download = () => {
    if (!ready || ready.key !== JSON.stringify(design)) return;
    const anchor = document.createElement('a');
    anchor.href = ready.url; anchor.download = 'freedom-promo-01-' + design.ratio.replace(':', 'x') + '.png';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setDownloadedKey(key);
  };
  const errorText = fault
    ? fault.code === 'overflow' ? t('overflow', {field: t(fieldLabels[fault.field ?? 'body'])})
      : fault.code === 'field' ? t('fieldError', {field: t(fieldLabels[fault.field ?? 'title'])})
        : fault.code === 'fonts' ? t('fontsError') : t('renderError')
    : '';
  const [width, height] = PROMO_RATIOS[design.ratio];
  return <div className="promo-workspace">
    <section className="card stack promo-editor" aria-label={t('editor')}>
      <p className="field-hint">{t('sample')}</p>
      <div className="promo-settings">
        <label className="field"><span id="promo-ratio-label">{t('ratio')}</span><select aria-labelledby="promo-ratio-label" value={design.ratio} onChange={event => setDesign(current => ({...current, ratio: event.target.value as PromoRatio}))}>
          <option value="1:1">{t('square')}</option><option value="4:5">{t('portrait')}</option>
        </select></label>
        <label className="field"><span id="promo-accent-label">{t('accent')}</span><input type="color" aria-labelledby="promo-accent-label" value={design.accent} onChange={event => setDesign(current => ({...current, accent: event.target.value}))}/></label>
      </div>
      {(['label', 'title', 'body', 'footer'] as const).map(field => <label className="field" key={field}><span id={'promo-label-' + field}>{t(fieldLabels[field])}</span>
        <textarea value={design.pages[0][field]} rows={field === 'body' ? 5 : field === 'title' ? 3 : 2}
          maxLength={PROMO_LIMITS[field]} onChange={event => change(field, event.target.value)}
          aria-labelledby={'promo-label-' + field} aria-invalid={fault?.field === field || undefined}
          aria-describedby={'promo-limit-' + field + (fault?.field === field ? ' promo-error' : '')}
          required={field === 'title'}/>
        <small className="field-hint" id={'promo-limit-' + field}>{design.pages[0][field].length} / {PROMO_LIMITS[field]}</small>
      </label>)}
      {fault && <div className="banner banner-error stack" role="alert"><p id="promo-error">{errorText}</p><button className="btn btn-secondary btn-small" type="button" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button></div>}
      <div className="actions"><button className="btn btn-primary" type="button" disabled={!ready || !!fault} onClick={download}>{t('download')}</button></div>
      <p className="field-hint promo-render-status" role="status">{fault ? '' : ready
        ? t(downloadedKey === key ? 'started' : 'ready') + ' · ' + width + ' × ' + height : t('preparing')}</p>
    </section>
    <section className="promo-image-panel" aria-label={t('preview')}>
      <div className="promo-paper" style={{aspectRatio: width / height}} aria-busy={!ready && !fault}>
        {ready ? <img src={ready.url} width={width} height={height} alt={t('preview')} data-source-fingerprint={ready.sourceFingerprint}/>
          : <p className="promo-placeholder">{fault ? errorText : t('preparing')}</p>}
      </div>
    </section>
  </div>;
}
