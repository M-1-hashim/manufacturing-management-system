// تبدیل مبلغ به حروف — دری / پشتو / انگلیسی
// مشترک بین همهٔ بل‌ها و اسناد چاپی (فروش، مالی، معاش و...)
import type { Currency } from '@/lib/format'

type NumLang = 'fa' | 'ps' | 'en'

const NUM_WORDS: Record<
  NumLang,
  { ones: string[]; teens: string[]; tens: string[]; hundreds: string[]; scales: string[]; zero: string; join: string }
> = {
  fa: {
    ones: ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'],
    teens: ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'],
    tens: ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'],
    hundreds: ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'],
    scales: ['', 'هزار', 'میلیون', 'میلیارد'],
    zero: 'صفر',
    join: ' و ',
  },
  ps: {
    ones: ['', 'یو', 'دوه', 'درې', 'څلور', 'پنځه', 'شپږ', 'اووه', 'اته', 'نهه'],
    teens: ['لس', 'یوولس', 'دولس', 'دیارلس', 'څوارلس', 'پنځلس', 'شپاړلس', 'اوه لس', 'اتلس', 'نولس'],
    tens: ['', '', 'شل', 'دېرش', 'څلویښت', 'پنځوس', 'شپېته', 'اویا', 'اتیا', 'نوي'],
    hundreds: ['', 'سل', 'دوه سوه', 'درې سوه', 'څلور سوه', 'پنځه سوه', 'شپږ سوه', 'اوه سوه', 'اته سوه', 'نهه سوه'],
    scales: ['', 'زره', 'میلیون', 'میلیارد'],
    zero: 'صفر',
    join: ' او ',
  },
  en: {
    ones: ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
    teens: ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'],
    tens: ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'],
    hundreds: [
      '', 'one hundred', 'two hundred', 'three hundred', 'four hundred',
      'five hundred', 'six hundred', 'seven hundred', 'eight hundred', 'nine hundred',
    ],
    scales: ['', 'thousand', 'million', 'billion'],
    zero: 'zero',
    join: ' ',
  },
}

const CURRENCY_WORDS: Record<Currency, { fa: string; ps: string; en: string }> = {
  AFN: { fa: 'AFG', ps: 'AFG', en: 'AFG' },
  USD: { fa: 'دالر امریکایی', ps: 'امریکایی ډالر', en: 'US Dollar' },
  PKR: { fa: 'کلدار پاکستانی', ps: 'پاکستاني کلدار', en: 'Pakistani Rupee' },
}

/** تبدیل عدد 1 تا 999 به حروف */
function threeDigitWords(lang: NumLang, n: number): string {
  const w = NUM_WORDS[lang]
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (h) parts.push(w.hundreds[h])
  if (rest >= 10 && rest < 20) {
    parts.push(w.teens[rest - 10])
  } else {
    const tn = Math.floor(rest / 10)
    const on = rest % 10
    if (tn) parts.push(w.tens[tn])
    if (on) parts.push(w.ones[on])
  }
  return parts.join(w.join)
}

/** تبدیل عدد صحیح به حروف */
function intWords(lang: NumLang, n: number): string {
  const w = NUM_WORDS[lang]
  if (n <= 0) return w.zero
  const groups: string[] = []
  let i = 0
  while (n > 0 && i < w.scales.length) {
    const g = n % 1000
    if (g > 0) groups.unshift(threeDigitWords(lang, g) + (w.scales[i] ? ` ${w.scales[i]}` : ''))
    n = Math.floor(n / 1000)
    i++
  }
  return groups.join(w.join)
}

/** مبلغ به حروف — «پنج هزار و دویست افغانی فقط» */
export function amountToWords(amount: number, currency: Currency, lang: NumLang): string {
  const w = NUM_WORDS[lang]
  const abs = Math.abs(amount)
  let int = Math.floor(abs)
  let dec = Math.round((abs - int) * 100)
  if (dec >= 100) {
    int += 1
    dec = 0
  }
  let s = `${intWords(lang, int)} ${CURRENCY_WORDS[currency][lang]}`
  if (dec > 0) {
    const unit = lang === 'fa' ? 'سنت' : lang === 'ps' ? 'پیسې' : 'cent'
    s += `${w.join}${intWords(lang, dec)} ${unit}`
  }
  s += lang === 'en' ? ' only' : ' فقط'
  return amount < 0 ? `${lang === 'en' ? 'minus ' : 'منفی '}${s}` : s
}
