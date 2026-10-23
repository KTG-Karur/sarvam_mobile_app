import type { ApplicationFormRecord } from './application-form-data';
import { calculateAge } from '@/app/lib/date-utils';

const TRUST_NAME_TAMIL = 'சர்வம் அறக்கட்டளை';
const TRUST_NAME_ENGLISH = 'SARVAM CHARITABLE TRUST';

// ─── Formatting helpers ─────────────────────────────────────────────────────

export const formatDate = (dateStr?: string) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return '';
  }
};

export { calculateAge };

export const maskAadhar = (value?: string) => {
  if (!value) return '';
  if (value.length >= 8) return `XXXX XXXX ${value.slice(-4)}`;
  return value;
};

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${TENS[tens]}${ones ? ' ' + ONES[ones] : ''}`;
}

function threeDigitWords(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigitWords(rest));
  return parts.join(' ');
}

/** Converts a rupee amount to English words using the Indian numbering system (Lakh/Crore). */
export function amountToWords(amount: number): string {
  const value = Math.round(Math.abs(amount || 0));
  if (value === 0) return 'Zero Rupees Only';

  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  const hundred = value % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (hundred) parts.push(threeDigitWords(hundred));

  return `${parts.join(' ')} Rupees Only`;
}

const inr = (n?: number) =>
  n ? '₹' + n.toLocaleString('en-IN') : '';

const dashIfEmpty = (v?: string | number) =>
  v === undefined || v === null || v === '' ? '' : String(v);

// ─── Page builders ───────────────────────────────────────────────────────────

function buildLoanApplicationPage(client: ApplicationFormRecord, logoSrc: string): string {
  const annualIncome = client.monthlyIncome ? client.monthlyIncome * 12 : 0;
  const loanAmount = client.loanAmount || client.loanProductAmount || client.requestedAmount || 0;
  const occupation = client.economicActivity || client.occupation || '';
  const spouseAge = calculateAge(client.spouseDob);

  return `
    <div class="page">
      <div class="container">
        ${buildTrustHeader(logoSrc)}
        <div class="mandalam-line">மண்டலம்: ${client.branchName || ''} - மகளிர் கூட்டு பொறுப்பு குழு (JLG)</div>
        <div class="doc-title-row">
          <div>வ.எண். <span class="dline">${dashIfEmpty(client.account)}</span></div>
          <div class="doc-title-box">கடன் விண்ணப்பம்</div>
          <div>தேதி <span class="dline">${formatDate(client.dateOfJoining)}</span></div>
        </div>

        <table class="tgrid">
          <tr>
            <td class="tgrid-label">உறுப்பினர் பெயர்</td>
            <td class="tgrid-value">${client.clientName}</td>
            <td class="tgrid-label">கிளையின் பெயர்</td>
            <td class="tgrid-value">${client.branchName}</td>
          </tr>
          <tr>
            <td class="tgrid-label">உறுப்பினர் வயது</td>
            <td class="tgrid-value">${dashIfEmpty(client.age)}</td>
            <td class="tgrid-label">மைய எண்</td>
            <td class="tgrid-value">${client.centerCode}</td>
          </tr>
          <tr>
            <td class="tgrid-label">கணவர் பெயர்</td>
            <td class="tgrid-value">${client.spouseName}</td>
            <td class="tgrid-label">உறுப்பினர் எண் (Client ID)</td>
            <td class="tgrid-value">${client.clientId}</td>
          </tr>
          <tr>
            <td class="tgrid-label">கணவர் வயது</td>
            <td class="tgrid-value">${dashIfEmpty(spouseAge ?? undefined)}</td>
            <td class="tgrid-label">குடும்ப மொத்த ஆண்டு வருமானம்</td>
            <td class="tgrid-value">${dashIfEmpty(annualIncome)}</td>
          </tr>
          <tr>
            <td class="tgrid-label">கைபேசி / தொலைபேசி எண்</td>
            <td class="tgrid-value">${client.phone}</td>
            <td class="tgrid-label">கடன் கோரும் தொழில்</td>
            <td class="tgrid-value">${occupation}</td>
          </tr>
          <tr>
            <td class="tgrid-label">தற்போதைய முகவரி</td>
            <td class="tgrid-value" rowspan="2">${client.permanentAddress}${client.pincode ? ' - ' + client.pincode : ''}</td>
            <td class="tgrid-label">கடன் கோரும் தொகை</td>
            <td class="tgrid-value"><span class="amount-box">${loanAmount ? '₹ ' + loanAmount.toLocaleString('en-IN') : ''}</span></td>
          </tr>
          <tr>
            <td class="tgrid-label">பின் கோடு</td>
            <td class="tgrid-label">நிதி நிறுவனம்</td>
            <td class="tgrid-value"><span class="amount-box "></span></td>
          </tr>
        </table>

        <div class="section-title-box">மற்ற குறுநிதி நிறுவனத்தில் உறுப்பினர் விவரம்</div>
        <table class="form-table">
          <tr>
            <td class="label-cell" style="width:30%">குறுநிதி நிறுவன பெயர்</td>
            <td class="label-cell" style="width:20%">கடன் பெற்ற தேதி</td>
            <td class="label-cell" style="width:20%">கடன் தொகை</td>
            <td class="label-cell" style="width:30%">தற்போது நிலுவைத்தொகை</td>
          </tr>
          <tr>
            <td class="value-cell">&nbsp;</td>
            <td class="value-cell">&nbsp;</td>
            <td class="value-cell">&nbsp;</td>
            <td class="value-cell">&nbsp;</td>
          </tr>
        </table>

        <div class="section-title-box">கடன் விதிமுறைகள் - நிபந்தனைகள்</div>
        <ol class="terms-list">
          <li>மேலே குறிப்பிட்டுள்ள குடும்ப வருமானம், மற்ற குறுநிதி நிறுவனத்தில் உறுப்பினர் மற்றும் கடன் நிலுவை விவரம், உண்மை என்று உறுதியளிக்கிறேன்.</li>
          <li>வார தவணைகளில் கட்டுவதற்கு ஏற்ப கடன் வழங்கும்படி கேட்டுக் கொள்கிறேன். நான் மையக்கூட்டங்களில் கலந்து கொண்டு, கடன் தவணையை தவறாமல் செலுத்துவேன்.</li>
          <li>மையக்கூட்டத்திற்கு வரும்போது கடன் அட்டையை தவறாமல் கொண்டுவந்து அதில் செலுத்திய தொகையை வரவு வைத்து பெற்றுக் கொள்வேன்.</li>
          <li>மையக்கூட்டம் முடியும் வரை முழுமையாக கலந்து கொள்வேன்.</li>
          <li>நான் வாங்கிய கடனை கடன் கோரிய நோக்கத்திற்காக மட்டுமே பயன்படுத்துவேன்.</li>
          <li>நிறுவனத்தின் அனைத்து விதிமுறைகளையும் பின்பற்றி, நான் சார்ந்துள்ள மையத்தின் செயல்பாட்டிற்கு ஒத்துழைப்பேன்.</li>
          <li>எனது மையத்தில் ஒரு உறுப்பினர் கடன் தவணையை கட்ட முடியவில்லை என்றால், நான் மையத்தின் பிற உறுப்பினர் அனைவருடனும் ஒன்று சேர்ந்து அந்தக் கடன் தவணையை அன்றே கட்டி விடுவோம்.</li>
          <li>கடனை குறிப்பிட்ட காலத்திற்கு முன்னரே முழுமையாக செலுத்த விருப்பினால் நேரடியாக கிளைக்கு வந்து, பின்வட்டி இல்லாமல் அசலை மட்டும் செலுத்தி கடனை முடித்துக் கொள்ள சம்மதிக்கிறேன்.</li>
          <li>கடன் பெறும் பொழுது கடன் பரிசீலனை கட்டணம் 1% (சதவிகிதம்) செலுத்த சம்மதிக்கிறேன். மேலும் இன்சூரன்ஸ் பிரிமியம் கட்ட சம்மதிக்கிறேன்.</li>
          <li>நான் பெறும் கடன் தொகைக்கு வருடாந்திர வட்டி (கட்டக்கட்ட குறையும் வட்டி விகிதப்படி) செலுத்த சம்மதிக்கிறேன்.</li>
          <li>மேலே கூறப்பட்ட சரத்துக்களை அதிகாரிகள் மற்றும் மையத்தலைவி படிக்க, அதை கேட்டு, புரிந்து கொண்டு, சம்மதம் தெரிவித்து சுய நினைவோடு கையொப்பம் இடுகிறேன்.</li>
        </ol>

        <div class="place-date-sign-row">
          <div>இடம் : <span class="dline">${client.permanentAddress ? client.permanentAddress.split(',')[0] : ''}</span></div>
          <div>தேதி : <span class="dline"></span></div>
          <div class="sig-item" style="flex:0 0 220px">
            <div class="sig-line"></div>
            <div class="sig-label">விண்ணப்பதார் கையொப்பம்</div>
          </div>
        </div>
      </div>
    </div>`;
}

function buildRecommendationPage(client: ApplicationFormRecord, logoSrc: string): string {
  const annualIncome = client.monthlyIncome ? client.monthlyIncome * 12 : 0;
  const incomeEarner = client.spouseName || client.clientName;
  const loanAmount = client.loanAmount || client.loanProductAmount || client.requestedAmount || 0;
  const occupation = client.economicActivity || client.occupation || '';

  return `
    <div class="page">
      <div class="container">
        ${buildTrustHeader(logoSrc)}
        <div class="doc-title-row" style="justify-content: space-between;">
          <div class="doc-title-box">கடன் பரிந்துரை</div>
          <div>தேதி : <span class="dline">${formatDate(client.dateOfJoining)}</span></div>
        </div>

        <table class="tgrid">
          <tr>
            <td class="tgrid-label">குழுவில் சேர்ந்த நாள்</td>
            <td class="tgrid-value">${formatDate(client.dateOfJoining)}</td>
            <td class="tgrid-label">குடும்ப உறுப்பினர்கள்</td>
            <td class="tgrid-value"></td>
          </tr>
          <tr>
            <td class="tgrid-label">மொத்த கூட்ட நாட்கள்</td>
            <td class="tgrid-value"></td>
            <td class="tgrid-label">வருமானம் ஈட்டும் நபர்</td>
            <td class="tgrid-value">${incomeEarner}</td>
          </tr>
          <tr>
            <td class="tgrid-label">மொத்த வருகை நாட்கள்</td>
            <td class="tgrid-value"></td>
            <td class="tgrid-label">குடும்ப மொத்த வருமானம்</td>
            <td class="tgrid-value">${dashIfEmpty(annualIncome)}</td>
          </tr>
          <tr>
            <td class="tgrid-label">முந்தைய கடன் தொகை</td>
            <td class="tgrid-value"></td>
            <td class="tgrid-label">கட்டி முடிந்த தேதி</td>
            <td class="tgrid-value"></td>
          </tr>
          <tr>
            <td class="tgrid-label">முந்தைய கடன் பெற்ற தேதி</td>
            <td class="tgrid-value"></td>
            <td class="tgrid-label" rowspan="2" style="vertical-align:middle">குழு தலைவி கையொப்பம்</td>
            <td class="tgrid-value" rowspan="2"></td>
          </tr>
          <tr>
            <td class="tgrid-label">மற்ற கடன் நிலுவை தொகை</td>
            <td class="tgrid-value"></td>
          </tr>
          <tr>
            <td class="tgrid-label">கடன் சுற்று</td>
            <td class="tgrid-value" colspan="3"></td>
          </tr>
        </table>

        <div class="section-title-box">குழுவின் சிபாரிசு</div>
        <div class="declaration-box">
          <div class="declaration-text">
            மேற்குறிப்பிட்ட உறுப்பினருக்கு, கோரப்பட்ட கடன் தொகைக்கு, தீர்மானத்தில் கையொப்பமிட்ட உறுப்பினர்கள் அனைவரும் பரிந்துரைக்கிறோம். இவர் தவணையை கட்ட தவறினால், நாங்கள் அனைவரும் ஒன்று சேர்ந்து அத்தவணையை அன்றே கட்டி விடுகிறோம் என்று உறுதி அளிக்கிறோம்.
          </div>
          <div class="signature-row-double">
            <div class="sig-item">
              <div class="sig-line"></div>
              <div class="sig-label">குழு தலைவி கையொப்பம்</div>
            </div>
            <div class="sig-item">
              <div class="sig-line"></div>
              <div class="sig-label">குழு உறுப்பினர் கையொப்பம்</div>
            </div>
          </div>
          <div class="signature-row-double">
            <div class="sig-item">
              <div class="sig-line"></div>
              <div class="sig-label">குழு உறுப்பினர் கையொப்பம்</div>
            </div>
            <div class="sig-item">
              <div class="sig-line"></div>
              <div class="sig-label">குழு உறுப்பினர் கையொப்பம்</div>
            </div>
          </div>
        </div>

        <table class="form-table" style="margin-top:16px">
          <tr>
            <td class="label-cell" style="width:20%">கடன் திட்டம்</td>
            <td class="value-cell" style="width:30%">${client.loanProductTypeName || client.loanProductName || ''}</td>
            <td class="label-cell" style="width:20%">கோரிய கடன் தொகை</td>
            <td class="value-cell" style="width:30%">${inr(loanAmount)}</td>
          </tr>
          <tr>
            <td class="label-cell">கடன் கோரும் தொழில்</td>
            <td class="value-cell">${occupation}</td>
            <td class="label-cell">பரிந்துரை தொகை</td>
            <td class="value-cell">${inr(loanAmount)}</td>
          </tr>
        </table>

        <div class="signatures-row" style="margin-top:32px">
          <div class="sig-item">
            <div class="sig-line"></div>
            <div class="sig-label">களப்பணி அலுவலர்<br/>(FDO)</div>
          </div>
          <div class="sig-item">
            <div class="sig-line"></div>
            <div class="sig-label">கிளை மேலாளர்<br/>(Branch Manager)</div>
          </div>
          <div class="sig-item">
            <div class="sig-line"></div>
            <div class="sig-label">வட்டார மேலாளர்<br/>(Area Manager)</div>
          </div>
        </div>
      </div>
    </div>`;
}

function buildDemandNotePage(client: ApplicationFormRecord, logoSrc: string): string {
  const loanAmount = client.loanAmount || client.loanProductAmount || client.requestedAmount || 0;
  const addressLine = client.permanentAddress
    ? `கதவு எண் ${client.permanentAddress}${client.pincode ? '-' + client.pincode : ''}`
    : '';

  return `
    <div class="page">
      <div class="container">
        ${buildTrustHeader(logoSrc)}
        <div class="doc-title-row" style="justify-content: space-between;">
          <div>ரூ. <span class="dline">${loanAmount ? loanAmount.toLocaleString('en-IN') : ''}</span></div>
          <div class="doc-title-box">ஆன் டிமாண்ட் பத்திரம்</div>
          <div>தேதி : <span class="dline"></span></div>
        </div>

        <div class="declaration-box">
          <div class="declaration-text">
            _______________ தேதி, ${addressLine} முகவரியில் வசிக்கும்
            ${client.spouseName ? ` திரு ${client.spouseName} ன்` : ''}
            ${client.clientName ? ` மனைவி திருமதி ${client.clientName}` : ''}
            ${client.age ? ` வயது ${client.age}` : ''}
            ஆகிய நான் எழுதிக்கொடுத்த ஆன் டிமாண்ட் பத்திரம் என்னவென்றால், எனது சுயதொழிலுக்காக நாளது தேதியன்று ${TRUST_NAME_TAMIL}
            நிறுவனத்திடமிருந்து கடனாக ரூ ${loanAmount ? loanAmount.toLocaleString('en-IN') : ''}/=(ரூபாய் ${amountToWords(loanAmount)}) ரொக்கமாக பெற்றுக்கொண்டேன்.
            மேற்கண்ட தொகைக்கு ஆண்டுக்கு சதவீத வட்டி ஆகும். மேற்படி தொகையை அசலுடன் வட்டியும் சேர்த்து, நாங்கள் கேட்கும் பொழுது தங்களிடமாவது, தங்கள் உத்திரவு பெற்றவர்களிடமிருந்து திரும்பி கொடுத்து, இந்த ஆன் டிமாண்ட் பத்திரத்தை திரும்ப பெற்றுக் கொள்கிறான் என்று சம்மதித்து எழுதி கொடுக்கிறேன்.
          </div>
          <div class="sign-place-row">
            <div class="place-box">
              <div>இடம் : <span class="dline">${client.permanentAddress ? client.permanentAddress.split(',')[0] : ''}</span></div>
              <div style="margin-top:14px;">கிளை : <span class="dline">${client.branchName}</span></div>
            </div>
            <div class="stamp-sign-box">
              <div class="sig-line" style="margin-top:45px;"></div>
              <div class="sig-label">உறுப்பினர் கையொப்பம்</div>
            </div>
          </div>
          <div class="divider"></div>
          <div class="declaration-text" style="margin-top: 10px;">
            இதே குழுவை / மையத்தை சேர்ந்த நாங்கள் இருவரும் மேற்குறிப்பிட்ட கடன் தொகையை உறுப்பினர் வாங்கியதற்கு சாட்சிகள்.
          </div>
          <div class="signature-row-double" style="margin-top:8px;">
            <div class="sig-item">
              <div class="sig-line"></div>
              <div class="sig-label">சாட்சி - 1 கையொப்பம்</div>
            </div>
            <div class="sig-item">
              <div class="sig-line"></div>
              <div class="sig-label">சாட்சி - 2 கையொப்பம்</div>
            </div>
          </div>
          <div class="divider"></div>
          <div class="declaration-text" style="margin-top: 10px;">
            மேற்கண்ட உறுப்பினர் தான் வாங்கிய கடன் தொகையை கட்ட தவறினால், என்னிடமிருந்து சம்மந்தப்பட்ட சட்டப்படி, கடன் தொகையை வட்டியுடன் வசூல் செய்து கொள்ளலாம்.
          </div>
          <div class="sign-place-row">
            <div class="place-box">
              <div>கைபேசி எண் : <span class="dline">${client.spouseMobile}</span></div>
            </div>
            <div class="stamp-sign-box">
              <div class="sig-line" style="margin-top:38px;"></div>
              <div class="sig-label">உறுப்பினர் கணவர் / பாதுகாவலர் கையொப்பம்</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function buildMemberApplicationPage(client: ApplicationFormRecord, logoSrc: string): string {
  const clientPhoto = client.kycDocuments?.find((d) => d.type === 'client_photo')?.url;
  const annualIncome = client.monthlyIncome ? client.monthlyIncome * 12 : 0;
  const houseOptions = ['வாடகை', 'குத்தகை', 'சொந்தம்'];

  return `
    <div class="page member-form-page">
      <div class="container">
        ${buildTrustHeader(logoSrc)}
        <div class="doc-title-row" style="justify-content:center; position:relative; min-height:114px;">
          <div class="doc-title-box">உறுப்பினர் விண்ணப்ப படிவம்</div>
          <div class="member-photo-box">
            ${clientPhoto ? `<img src="${clientPhoto}" alt="Member Photo" />` : ''}
          </div>
        </div>

        <table class="tgrid" style="margin-top:8px">
          <tr>
            <td class="tgrid-label">கிளை</td>
            <td class="tgrid-value">${client.branchName}</td>
            <td class="tgrid-label">மைய எண்</td>
            <td class="tgrid-value">${client.centerCode}</td>
            <td class="tgrid-label">குழு எண்/உறுப்பினர் எண்</td>
            <td class="tgrid-value">${client.clientId}</td>
            <td class="tgrid-label">உறுப்பினரான நாள்</td>
            <td class="tgrid-value">${formatDate(client.dateOfJoining)}</td>
          </tr>
        </table>

        <table class="form-table numbered-table" style="margin-top:10px">
          <tr>
            <td class="num-cell">1.</td>
            <td class="label-cell">பெயர்</td>
            <td class="value-cell" colspan="2">${client.clientName}</td>
            <td class="label-cell">பிறந்த தேதி</td>
            <td class="value-cell">${formatDate(client.dob)}</td>
            <td class="label-cell">வயது</td>
            <td class="value-cell">${dashIfEmpty(client.age)}</td>
          </tr>
          <tr>
            <td class="num-cell">2.</td>
            <td class="label-cell">தந்தை பெயர்</td>
            <td class="value-cell" colspan="2">${client.fatherName}</td>
            <td class="label-cell">தாயார் பெயர்</td>
            <td class="value-cell" colspan="3">${client.motherName}</td>
          </tr>
          <tr>
            <td class="num-cell">3.</td>
            <td class="label-cell">கணவர் / பாதுகாவலர் பெயர்</td>
            <td class="value-cell" colspan="6">${client.spouseName}</td>
          </tr>
          <tr>
            <td class="num-cell">4.</td>
            <td class="label-cell">தற்போதைய முகவரி</td>
            <td class="value-cell" colspan="3">${client.permanentAddress}</td>
            <td class="label-cell">நிரந்தர முகவரி</td>
            <td class="value-cell" colspan="2">${client.permanentAddress}</td>
          </tr>
          <tr>
            <td class="num-cell"></td>
            <td class="label-cell">PIN கோடு</td>
            <td class="value-cell" colspan="6">${client.pincode}</td>
          </tr>
          <tr>
            <td class="num-cell">5.</td>
            <td class="label-cell">R.C.NO</td>
            <td class="value-cell" colspan="2"></td>
            <td class="label-cell">I.D.NO</td>
            <td class="value-cell" colspan="3"></td>
          </tr>
          <tr>
            <td class="num-cell">6.</td>
            <td class="label-cell">வங்கி / அஞ்சலகம் கணக்கு எண்</td>
            <td class="value-cell" colspan="6">${client.bankAcNo}${client.bankName ? ' - ' + client.bankName : ''}</td>
          </tr>
          <tr>
            <td class="num-cell">7.</td>
            <td class="label-cell">தொலைபேசி எண்</td>
            <td class="value-cell" colspan="2">(அ) உறுப்பினர்: ${client.phone}</td>
            <td class="value-cell" colspan="4">(ஆ) கணவர்: ${client.spouseMobile}</td>
          </tr>
          <tr>
            <td class="num-cell">8.</td>
            <td class="label-cell">அ. கல்வி நிலை</td>
            <td class="value-cell" colspan="2">${client.qualification}</td>
            <td class="label-cell">ஆ. நிலமற்ற விவசாய கூலியா?</td>
            <td class="value-cell" colspan="3">ஆம் / இல்லை</td>
          </tr>
          <tr>
            <td class="num-cell">9.</td>
            <td class="label-cell">தொழில்</td>
            <td class="value-cell" colspan="6">A. விவசாயம் &nbsp;&nbsp;&nbsp; B. இதர தொழில் &mdash; ${client.economicActivity || client.occupation}</td>
          </tr>
          <tr>
            <td class="num-cell">10.</td>
            <td class="label-cell">திருமண நிலை</td>
            <td class="value-cell" colspan="6">${client.maritalStatus}</td>
          </tr>
          <tr>
            <td class="num-cell">11.</td>
            <td class="label-cell">மதம்</td>
            <td class="value-cell" colspan="2">${client.religion}</td>
            <td class="label-cell">இனம்</td>
            <td class="value-cell" colspan="3">${client.caste}</td>
          </tr>
        </table>

        <div class="section-title-box" style="margin-top:10px">12. குடும்ப உறுப்பினர் வருமானம்</div>
        <table class="form-table">
          <tr>
            <td class="label-cell">பெயர்</td>
            <td class="label-cell">வயது</td>
            <td class="label-cell">ஆ/பெ</td>
            <td class="label-cell">உறவுமுறை</td>
            <td class="label-cell">கல்வி நிலை</td>
            <td class="label-cell">தொழில்</td>
            <td class="label-cell">ஆண்டு வருமானம் (ரூ)</td>
          </tr>
          <tr>
            <td class="value-cell">${client.spouseName}</td>
            <td class="value-cell">${dashIfEmpty(client.age)}</td>
            <td class="value-cell">${client.spouseGender}</td>
            <td class="value-cell">Spouse</td>
            <td class="value-cell"></td>
            <td class="value-cell">${client.spouseEconomicActivity}</td>
            <td class="value-cell">${dashIfEmpty(annualIncome)}</td>
          </tr>
          <tr>
            <td class="label-cell" colspan="3">மொத்த நபர்கள்:</td>
            <td class="value-cell" colspan="4">குடும்ப மொத்த வருமானம்: ${dashIfEmpty(annualIncome)}</td>
          </tr>
        </table>

        <table class="form-table numbered-table" style="margin-top:10px">
          <tr>
            <td class="num-cell">13.</td>
            <td class="label-cell">வீட்டின் விவரம்</td>
            <td class="value-cell" colspan="6">${houseOptions.map((o) => (client.houseStatus && client.houseStatus.includes(o) ? `<b>[${o}]</b>` : o)).join(' &nbsp; ')}</td>
          </tr>
          <tr>
            <td class="num-cell"></td>
            <td class="label-cell">அறைகள் / மின்வசதி / குடிநீர் வசதி</td>
            <td class="value-cell" colspan="6"></td>
          </tr>
          <tr>
            <td class="num-cell">14.</td>
            <td class="label-cell">சொத்து</td>
            <td class="value-cell" colspan="6">நிலம்: (சொந்தம் / குத்தகை) &nbsp;&nbsp; பால் மாடு: &nbsp;&nbsp; ஆடு / மாடு / கோழி:</td>
          </tr>
          <tr>
            <td class="num-cell">15.</td>
            <td class="label-cell" colspan="3">மற்ற குறுநிதி நிறுவனத்தில், உறுப்பினர் பெற்ற கடன் தொகை விவரம்</td>
            <td class="value-cell" colspan="4"></td>
          </tr>
        </table>

        <div class="declaration-box" style="margin-top:10px">
          <div class="declaration-text">
            மேலே கொடுக்கப்பட்டுள்ள விபரங்கள் உண்மை என உறுதி செய்கிறேன். எனக்கு அளிக்கப்பட்ட குழுப் பயிற்சியில் கடன் திட்டத்தின் விபரங்களை பரிந்துரையாளர் விளக்கினார்.
            நான் வாங்கும் கடனை முறையாகவும், வருமானத்தை பெருக்கி வறுமையை ஒழிக்க பயன்படுத்துவேன் எனவும், ஒப்புக் கொண்டபடி உரிய காலத்தில் வட்டியுடன் திரும்பக் கட்டிவிடுவேன் என்றும் உறுதியளிக்கிறேன்.
            நிறுவன விதிமுறைகளுக்கு நான் என்றும் கட்டுப்படுவேன் என்றும், எங்கள் மையக் கூட்டங்களில் கலந்து கொள்வேன் என்றும் உறுதி அளிக்கிறேன்.
          </div>
          <div class="signature-row-double" style="margin-top:8px">
            <div class="sig-item" style="text-align:left">
              <div class="sig-line" style="max-width:220px; margin-left:0; margin-top:20px;"></div>
              <div class="sig-label">பரிந்துரைப்பவர் பெயர் &amp; உறவு முறை &amp; கையொப்பம்</div>
            </div>
            <div class="sig-item">
              <div class="sig-line" style="margin-top:20px;"></div>
              <div class="sig-label">உறுப்பினர் கையொப்பம்</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function buildTrustHeader(logoSrc: string): string {
  return `
    <div class="trust-header">
      <img src="${logoSrc}" class="trust-logo" alt="${TRUST_NAME_ENGLISH}" onerror="this.style.display='none'" />
      <h1 class="trust-title">${TRUST_NAME_TAMIL}</h1>
    </div>`;
}

// ─── KYC / photo pages (unchanged in content, retained after the 4 Tamil pages) ──

function buildSupportingDocsPages(client: ApplicationFormRecord): string {
  const clientPhoto = client.kycDocuments?.find((doc) => doc.type === 'client_photo')?.url;
  const coApplicantPhoto = client.kycDocuments?.find((doc) => doc.type === 'co_applicant_photo')?.url;
  const bankPassbook = client.kycDocuments?.find((doc) => doc.type === 'bank_passbook')?.url;
  const houseImage = client.kycDocuments?.find((doc) => doc.type === 'house_image_1')?.url;
  const locationQr = client.kycDocuments?.find((doc) => doc.type === 'location_qr')?.url;
  const applicantAadharFront = client.kycDocuments?.find((doc) => doc.type === 'aadhaar_front');
  const applicantAadharBack = client.kycDocuments?.find((doc) => doc.type === 'aadhaar_back');
  const coApplicantAadharBack = client.kycDocuments?.find((doc) => doc.type === 'co_applicant_aadhaar_back');
  const applicantVoterId = client.kycDocuments?.find((doc) => doc.type === 'voter_id');
  const coApplicantVoterId = client.kycDocuments?.find((doc) => doc.type === 'co_applicant_voter_id');
  const applicantPanCard = client.kycDocuments?.find((doc) => doc.type === 'pan_card');
  const coApplicantPanCard = client.kycDocuments?.find((doc) => doc.type === 'co_applicant_pan_card');
  const applicantSmartCard = client.kycDocuments?.find((doc) => doc.type === 'smart_card_front');
  const applicantSmartCardBack = client.kycDocuments?.find((doc) => doc.type === 'smart_card_back');
  const coApplicantOtherId = client.kycDocuments?.find((doc) => doc.type === 'co_applicant_other_id');

  const usedTypes = new Set([
    'aadhaar_front', 'aadhaar_back', 'co_applicant_aadhaar_front', 'co_applicant_aadhaar_back',
    'voter_id', 'co_applicant_voter_id', 'pan_card', 'co_applicant_pan_card',
    'smart_card_front', 'smart_card_back', 'co_applicant_other_id', 'client_photo',
    'co_applicant_photo', 'signature', 'co_applicant_signature', 'bank_passbook',
    'house_image', 'location_qr',
  ]);
  const remainingDocs = client.kycDocuments?.filter((doc) => !usedTypes.has(doc.type)) || [];

  const getDocDisplayName = (type: string) => {
    const names: Record<string, string> = {
      pan_card: 'PAN Card',
      co_applicant_pan_card: 'Co-Applicant PAN Card',
      voter_id: 'Voter ID',
      co_applicant_voter_id: 'Co-Applicant Voter ID',
      smart_card: 'Smart Card Front',
      smart_card_back: 'Smart Card Back',
      co_applicant_other_id: 'Co-Applicant Aadhar ID',
      aadhaar_front: 'Aadhaar Front',
      aadhaar_back: 'Aadhaar Back',
      co_applicant_aadhaar_front: 'Co-Applicant Aadhaar Front',
      co_applicant_aadhaar_back: 'Co-Applicant Aadhaar Back',
    };
    return names[type] || type.replace(/_/g, ' ').toUpperCase();
  };

  return `
    <div class="page">
      <div class="container">
        <div class="section-title">KYC DOCUMENTS / சான்றிதழ்கள்</div>

        <div class="docs-pair">
          ${applicantAadharFront ? `<div class="doc-card"><div class="doc-label">APPLICANT AADHAAR FRONT</div><img src="${applicantAadharFront.url}" alt="Applicant Aadhaar Front" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${applicantAadharBack ? `<div class="doc-card"><div class="doc-label">APPLICANT AADHAAR BACK</div><img src="${applicantAadharBack.url}" alt="Applicant Aadhaar Back" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${!applicantAadharFront && !applicantAadharBack ? '<div class="doc-card-placeholder"></div>' : ''}
        </div>

        <div class="docs-pair">
          ${coApplicantOtherId ? `<div class="doc-card"><div class="doc-label">CO-APPLICANT AADHAAR FRONT</div><img src="${coApplicantOtherId.url}" alt="Co-Applicant Aadhaar Front" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${coApplicantAadharBack ? `<div class="doc-card"><div class="doc-label">CO-APPLICANT AADHAAR BACK</div><img src="${coApplicantAadharBack.url}" alt="Co-Applicant Aadhaar Back" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${!coApplicantOtherId && !coApplicantAadharBack ? '<div class="doc-card-placeholder"></div>' : ''}
        </div>

        <div class="docs-pair">
          ${applicantVoterId ? `<div class="doc-card"><div class="doc-label">VOTER ID (Applicant)</div><img src="${applicantVoterId.url}" alt="Voter ID" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${coApplicantVoterId ? `<div class="doc-card"><div class="doc-label">VOTER ID (Co-Applicant)</div><img src="${coApplicantVoterId.url}" alt="Co-Applicant Voter ID" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${!applicantVoterId && !coApplicantVoterId ? '<div class="doc-card-placeholder"></div>' : ''}
        </div>

        <div class="docs-pair">
          ${applicantPanCard ? `<div class="doc-card"><div class="doc-label">PAN CARD (Applicant)</div><img src="${applicantPanCard.url}" alt="PAN Card" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${coApplicantPanCard ? `<div class="doc-card"><div class="doc-label">PAN CARD (Co-Applicant)</div><img src="${coApplicantPanCard.url}" alt="Co-Applicant PAN Card" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${!applicantPanCard && !coApplicantPanCard ? '<div class="doc-card-placeholder"></div>' : ''}
        </div>

        <div class="docs-pair">
          ${applicantSmartCard ? `<div class="doc-card"><div class="doc-label">SMART CARD FRONT</div><img src="${applicantSmartCard.url}" alt="Smart Card Front" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${applicantSmartCardBack ? `<div class="doc-card"><div class="doc-label">SMART CARD BACK</div><img src="${applicantSmartCardBack.url}" alt="Smart Card Back" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>` : ''}
          ${!applicantSmartCard && !applicantSmartCardBack ? '<div class="doc-card-placeholder"></div>' : ''}
        </div>

        ${
          remainingDocs.length > 0
            ? remainingDocs
                .map((doc, idx) => {
                  if (idx % 2 !== 0) return '';
                  const nextDoc = remainingDocs[idx + 1];
                  return `
                    <div class="docs-pair">
                      <div class="doc-card">
                        <div class="doc-label">${getDocDisplayName(doc.type)}</div>
                        <img src="${doc.url}" alt="${doc.type}" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" />
                      </div>
                      ${
                        nextDoc
                          ? `<div class="doc-card"><div class="doc-label">${getDocDisplayName(nextDoc.type)}</div><img src="${nextDoc.url}" alt="${nextDoc.type}" class="doc-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" /></div>`
                          : '<div class="doc-card-placeholder"></div>'
                      }
                    </div>`;
                })
                .join('')
            : ''
        }
      </div>
    </div>

    <div class="page">
      <div class="container">
        <div class="section-title">PROPERTY VERIFICATION / சொத்து சரிபார்ப்பு</div>
        <div class="split-verification-container">
          <div class="verification-card house-card">
            <div class="verification-label">🏠 HOUSE / PROPERTY IMAGE</div>
            <div class="verification-image-container house-container">
              ${houseImage ? `<img src="${houseImage}" alt="House Image" class="house-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Image not available</div>'" />` : '<div class="doc-error">House image not available</div>'}
            </div>
          </div>
          <div class="verification-card qr-card">
            <div class="verification-label">📱 LOCATION QR</div>
            <div class="verification-image-container qr-container">
              ${locationQr ? `<img src="${locationQr}" alt="Location QR Code" class="qr-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>QR not available</div>'" />` : '<div class="doc-error">Location QR code not available</div>'}
            </div>
            <div class="qr-note">Scan to view location</div>
          </div>
        </div>
      </div>
    </div>

    ${
      bankPassbook
        ? `
    <div class="page">
      <div class="container">
        <div class="section-title">BANK PASSBOOK / வங்கி பாஸ்புக்</div>
        <div class="passbook-container">
          <img src="${bankPassbook}" alt="Bank Passbook" class="passbook-image" onerror="this.outerHTML='<div class=\\'doc-error\\'>Bank Passbook image not available</div>'" />
        </div>
      </div>
    </div>`
        : ''
    }
    ${!clientPhoto && coApplicantPhoto ? '' : ''}`;
}

// ─── Full document ───────────────────────────────────────────────────────────

export function buildApplicationFormHTML(
  clients: ApplicationFormRecord[],
  options?: { assetBaseUrl?: string; fontFaceCSS?: string; logoDataUri?: string }
): string {
  // Puppeteer's page.setContent() has no page origin, so relative asset URLs
  // (like the trust logo) never resolve there — the server-side PDF download
  // route resolves the logo server-side and passes it as a pre-compressed
  // data: URI (logoDataUri) instead of issuing a live HTTP fetch back into the
  // app; the client-side iframe preview leaves both unset and resolves the
  // relative branding URL fallback against the app in a real browser.
  const logoSrc = options?.logoDataUri || `${options?.assetBaseUrl || ''}/api/branding/asset/logo-wordmark`;

  // The client-side iframe preview renders in the user's own browser, which
  // resolves the 'Noto Sans Tamil' / 'Latha' font names against whatever is
  // installed on that OS. The server-side PDF download runs on headless
  // Chromium on the deploy host, which has no Tamil font installed at all —
  // the download route supplies this pre-embedded (base64 data URI)
  // @font-face block so the glyphs render identically everywhere instead of
  // falling back to tofu boxes in production.
  const fontFaceCSS = options?.fontFaceCSS || '';

  const pages = clients
    .map(
      (client) =>
        buildLoanApplicationPage(client, logoSrc) +
        buildRecommendationPage(client, logoSrc) +
        buildDemandNotePage(client, logoSrc) +
        buildMemberApplicationPage(client, logoSrc) +
        buildSupportingDocsPages(client)
    )
    .join('');

  return `<!DOCTYPE html>
    <html lang="ta">
      <head>
        <meta charset="UTF-8">
        <title>Application Form Report</title>
        <style>
        ${fontFaceCSS}
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
          font-family: 'Poppins', 'Noto Sans Tamil', 'Latha', Arial, Helvetica, sans-serif;
          background: white;
          color: black;
        }

        /*
         * Margin is intentionally NOT set via @page here. Headless PDF
         * generation (Puppeteer, preferCSSPageSize) and a real browser's
         * native print dialog (window.print()) can interpret an @page
         * margin differently — the print dialog's own "Margins" setting
         * can add to/override it, which made content that fit exactly one
         * page in the downloaded PDF spill onto a second page when printed
         * from the browser. Baking the margin into the page's own padding
         * (plain box-model CSS) instead makes it render identically in
         * both pipelines.
         */
        @page { size: A4; margin: 0; }

        .page {
          width: 210mm;
          min-height: 297mm;
          page-break-after: always;
          page-break-inside: avoid;
          background: white;
          position: relative;
          margin: 0 auto;
          padding: 12mm;
        }
        .page:last-child { page-break-after: auto; }
        .container { padding: 0; width: 100%; }

        /* Trust header */
        .trust-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          border-bottom: 2px solid #000;
          padding-bottom: 8px;
          margin-bottom: 8px;
          position: relative;
        }
        .trust-logo { height: 52px; width: auto; max-width: 160px; object-fit: contain; position: absolute; left: 0; }
        .trust-title { font-size: 25px; font-weight: bold; letter-spacing: 1px; }

        .mandalam-line { text-align: center; font-size: 12px; font-weight: 600; margin-bottom: 10px; }

        .doc-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          font-size: 11.5px;
          margin-bottom: 12px;
        }
        .doc-title-box {
          border: 1px solid #000;
          padding: 6px 18px;
          font-weight: bold;
          font-size: 16px;
          text-align: center;
        }
        .dline { display: inline-block; border-bottom: 1px dotted #000; min-width: 100px; padding: 0 6px; }
        .amount-box { display: inline-block; border: 1px solid #000; padding: 24px 24px; font-weight: bold; font-size: 12px; min-width: 120px; }

        .member-photo-box {
          position: absolute;
          right: 0;
          top: -4px;
          width: 90px;
          height: 110px;
          border: 1px solid #000;
          overflow: hidden;
          background: #fafafa;
        }
        .member-photo-box img { width: 100%; height: 100%; object-fit: cover; }

        /* Label:value grid (2 pairs per row) */
        .tgrid { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px; }
        .tgrid td { padding: 6px 8px; vertical-align: bottom; overflow-wrap: break-word; }
        .tgrid-label { font-weight: bold; white-space: nowrap; width: 1%; }
        .tgrid-value { border-bottom: 1px solid #000; padding-left: 8px; }

        .section-title-box {
          font-size: 12.5px;
          font-weight: bold;
          background: #e8e8e8;
          border: 1px solid #000;
          padding: 5px 10px;
          margin: 8px 0 6px 0;
          text-align: center;
        }
        .section-title {
          font-size: 14px;
          font-weight: bold;
          background: #e8e8e8;
          padding: 7px 12px;
          margin: 14px 0 10px 0;
          border: 1px solid #000;
          letter-spacing: 0.5px;
        }

        .terms-list { font-size: 10.5px; line-height: 1.5; padding-left: 20px; text-align: justify; }
        .terms-list li { margin-bottom: 5px; }

        .place-date-sign-row {
          display: flex;
          align-items: flex-end;
          gap: 24px;
          margin-top: 14px;
          font-size: 11px;
        }

        .form-table { width: 100%; border-collapse: collapse; border: 1px solid #000; font-size: 10.5px; }
        .form-table td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
        .label-cell { font-weight: bold; background: #f5f5f5; }
        .value-cell { }
        .num-cell { width: 18px; font-weight: bold; vertical-align: top; }
        .numbered-table .label-cell { width: 15%; }
        /* Row-label column (after the number): wide enough that the Tamil labels
           don't wrap to 3 lines; that wrapping pushed the member application page
           ~100px past A4 and the declaration box onto its own sheet. */
        .numbered-table td.label-cell:nth-child(2) { width: 24%; }
        /* Member application page: tighter rows so the whole form plus the
           declaration box fits one A4 sheet. */
        .member-form-page .form-table td { padding: 3px 6px; line-height: 1.3; }
        .member-form-page .tgrid td { padding: 4px 8px; }
        .member-form-page .tgrid-value { white-space: nowrap; }

        .declaration-box { margin: 10px 0 12px 0; padding: 10px; border: 1px solid #000; page-break-inside: avoid; break-inside: avoid; }
        .declaration-text { font-size: 10.5px; line-height: 1.4; text-align: justify; }

        .signature-row-double { display: flex; justify-content: space-between; gap: 25px; margin-top: 24px; page-break-inside: avoid; break-inside: avoid; }
        .signatures-row { display: flex; justify-content: space-between; margin-top: 28px; flex-wrap: wrap; page-break-inside: avoid; break-inside: avoid; }
        .sig-item { text-align: center; flex: 1; page-break-inside: avoid; break-inside: avoid; }
        .sig-line { border-bottom: 1px solid #000; width: 100%; max-width: 170px; margin: 38px auto 6px auto; height: 1px; }
        .sig-label { font-size: 9.5px; font-weight: normal; }

        .sign-place-row { display: flex; justify-content: space-between; margin-top: 20px; align-items: flex-end; }
        .place-box { text-align: left; font-size: 10.5px; line-height: 1.7; }
        .stamp-sign-box { text-align: center; min-width: 190px; }
        .divider { border-top: 1px solid #000; margin: 16px 0; }

        /* KYC document pages (unchanged from prior template) */
        .docs-pair { display: flex; gap: 14px; margin-bottom: 18px; page-break-inside: avoid; }
        .doc-card { flex: 1; border: 1px solid #ccc; padding: 6px; text-align: center; background: white; page-break-inside: avoid; }
        .doc-card-placeholder { flex: 1; }
        .doc-label { font-weight: bold; font-size: 8.5px; margin-bottom: 6px; background: #f0f0f0; padding: 3px; letter-spacing: 0.3px; }
        .doc-image { max-width: 100%; max-height: 180px; object-fit: contain; }
        .doc-error { padding: 25px; text-align: center; color: #999; font-size: 9px; }

        .split-verification-container { display: flex; gap: 16px; margin-top: 20px; margin-bottom: 20px; page-break-inside: avoid; min-height: 550px; }
        .verification-card { background: white; border: 2px solid #333; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; page-break-inside: avoid; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .house-card { flex: 3; }
        .qr-card { flex: 1; }
        .verification-label { font-weight: bold; font-size: 12px; margin-bottom: 12px; background: #e0e0e0; padding: 8px; letter-spacing: 0.5px; border-radius: 4px; text-align: center; }
        .verification-image-container { flex: 1; display: flex; justify-content: center; align-items: center; min-height: 400px; }
        .house-container { min-height: 450px; }
        .house-image { width: 100%; max-height: 500px; object-fit: contain; border: 1px solid #ddd; border-radius: 4px; }
        .qr-container { min-height: 200px; flex-direction: column; justify-content: center; }
        .qr-image { width: 100%; max-width: 160px; height: auto; object-fit: contain; border: 1px solid #ddd; border-radius: 8px; padding: 8px; }
        .qr-note { margin-top: 12px; font-size: 8px; color: #666; font-style: italic; text-align: center; word-break: break-word; }

        .passbook-container { border: 1px solid #000; padding: 10px; display: flex; justify-content: center; margin-top: 10px; page-break-inside: avoid; }
        .passbook-image { max-width: 100%; max-height: 60vh; object-fit: contain; }

        @media print {
          body { margin: 0; padding: 0; }
          .page { margin: 0; padding: 12mm; page-break-after: always; page-break-inside: avoid; }
          .split-verification-container { break-inside: avoid; page-break-inside: avoid; }
          .verification-card { break-inside: avoid; page-break-inside: avoid; }
          .house-image { max-height: 450px; }
          .qr-image { max-width: 130px; }
        }
        </style>
      </head>
      <body>
        ${pages}
      </body>
    </html>`;
}
