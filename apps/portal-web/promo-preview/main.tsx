import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LanguagePicker, LanguageProvider, useLanguage} from '../src/language';
import {PromotionalPreview} from '../src/modules/promotional-content/PromotionalPreview';
import {promoText} from '../src/modules/promotional-content/messages';
import '../src/styles.css';
import '../src/rpg-theme.css';
import '../src/light-theme.css';
import '../src/versefolk-theme.css';

function Preview() {
  const {language} = useLanguage();
  const [theme, setTheme] = useState('light');
  const t = (key: Parameters<typeof promoText>[1]) => promoText(language, key);
  return <main className="promo-preview-page">
    <header className="promo-preview-header">
      <img className="promo-preview-brand" src={new URL('../public/brand/freedom-workshop.webp', import.meta.url).href}
        alt="自由工坊" width="1280" height="720"/>
      <div><h1>{t('heading')}</h1><p>{t('notice')}</p></div>
      <div className="promo-preview-controls"><LanguagePicker/><label className="field"><span id="promo-theme-label">{t('theme')}</span>
        <select aria-labelledby="promo-theme-label" value={theme} onChange={event => {setTheme(event.target.value); document.documentElement.dataset.theme = event.target.value;}}>
          <option value="light">{t('light')}</option><option value="dark">{t('dark')}</option><option value="versefolk">{t('versefolk')}</option>
        </select></label></div>
    </header>
    <PromotionalPreview/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Preview/></LanguageProvider>);
