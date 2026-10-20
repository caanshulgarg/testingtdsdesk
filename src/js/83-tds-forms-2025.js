/* @react-lazy: begin 83-tds-forms-2025.js (the React app loads this file with its TDS return, Payroll and Settings screens: build.py react_parts) */
/* ================================================================== */
/* Forms 138, 140, 143 and 144 (Income-tax Act, 2025): the text file  */
/* as Protean's file format has it                                    */
/* ================================================================== */
// next-tds-forms-2025 (17-Oct-2026). The authority is Protean's file format, version 1.1 of 22-07-2026, which the owner
// uploaded: "Form Number 138 (24Q) - Q1 to Q3", "Form Number 140 (26Q) - Q1 to Q4", "Form Number 143 (27EQ) - Q1 to Q4",
// "Form Number 144 (27Q) - Q1 to Q4", with the Gazette forms (Form No. 138, 140, 143, 144). Field by field in
// docs/tds-forms-2025/<form>.md; what FinCom did before and what is still open in docs/tds-forms-2025/GAPS.md.
// Every record has the workbook's own number of fields (FH 18, BH 72, CD 30, DD 45) and each value is put at its field
// number (rec), so a field can be read against the workbook. Up to tax year 2025-26 the old builders run unchanged
// (TDS26Q.build, TDS24Q_FILE.build; TDS.isNew decides). Nothing here guesses: a value FinCom does not know is left out and
// named in problems; the file stays a draft (NEW_FORMS_VALIDATED, src/js/16) until Protean's FVU for these forms has
// passed a FinCom file. No AI anywhere in it.
const TDSF25 = {
  FORMAT: "Protean file format version 1.1 (22-07-2026)",
  FIELDS: {FH: 18, BH: 72, CD: 30, DD: 45},
  // FH field 3 (File Type): "SL1" for FN 138, "NS1" for FN 140 and 144, "TC1" for FN 143
  FILE_TYPE: {"24Q": "SL1", "26Q": "NS1", "27Q": "NS1", "27EQ": "TC1"},
  // Annexure 1 (and 5): state codes, as the workbooks list them
  STATES: {"ANDAMAN AND NICOBAR ISLANDS": "01", "ANDHRA PRADESH": "02", "ARUNACHAL PRADESH": "03", "ASSAM": "04", "BIHAR": "05", "CHANDIGARH": "06",
    "DADRA & NAGAR HAVELI AND DAMAN & DIU": "07", "DELHI": "09", "GOA": "10", "GUJARAT": "11", "HARYANA": "12", "HIMACHAL PRADESH": "13",
    "JAMMU & KASHMIR": "14", "KARNATAKA": "15", "KERALA": "16", "LAKSHWADEEP": "17", "MADHYA PRADESH": "18", "MAHARASHTRA": "19", "MANIPUR": "20",
    "MEGHALAYA": "21", "MIZORAM": "22", "NAGALAND": "23", "ODISHA": "24", "PONDICHERRY": "25", "PUNJAB": "26", "RAJASTHAN": "27", "SIKKIM": "28",
    "TAMIL NADU": "29", "TRIPURA": "30", "UTTAR PRADESH": "31", "WEST BENGAL": "32", "CHHATTISGARH": "33", "UTTARAKHAND": "34", "JHARKHAND": "35",
    "TELANGANA": "36", "LADAKH": "37"},
  // other spellings of the same states (the annexure's own spelling is the key above)
  STATE_ALIAS: {"PUDUCHERRY": "PONDICHERRY", "LAKSHADWEEP": "LAKSHWADEEP", "ORISSA": "ODISHA", "NCT OF DELHI": "DELHI", "NEW DELHI": "DELHI",
    "ANDAMAN & NICOBAR ISLANDS": "ANDAMAN AND NICOBAR ISLANDS", "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "DADRA & NAGAR HAVELI AND DAMAN & DIU",
    "JAMMU AND KASHMIR": "JAMMU & KASHMIR", "UTTARANCHAL": "UTTARAKHAND"},
  // Annexure 3: Ministry codes (BH field 57), for a Central Government deductor
  MINISTRIES: {
    "01": "Agriculture", "02": "Atomic Energy", "03": "Fertilizers", "04": "Chemicals and Petrochemicals",
    "05": "Civil Aviation and Tourism", "06": "Coal", "07": "Consumer Affairs, Food and Public Distribution",
    "08": "Commerce and Textiles", "09": "Environment and Forests and Ministry of Earth Science",
    "10": "External Affairs and Overseas Indian Affairs", "11": "Finance", "12": "Central Board of Direct Taxes",
    "13": "Central Board of Excise and Customs", "14": "Contoller of Aid Accounts and Audit",
    "15": "Central Pension Accounting Office", "16": "Food Processing Industries", "17": "Health and Family Welfare",
    "18": "Home Affairs and Development of North Eastern Region", "19": "Human Resource Development", "20": "Industry",
    "21": "Information and Broadcasting", "22": "Telecommunication and Information Technology", "23": "Labour",
    "24": "Law and Justice and Company Affairs", "25": "Personnel, Public Grievances and Pensions",
    "26": "Petroleum and Natural Gas", "27": "Plannning, Statistics and Programme Implementation", "28": "Power",
    "29": "New and Renewable Energy", "30": "Rural Development and Panchayati Raj", "31": "Science And Technology",
    "32": "Space", "33": "Steel", "34": "Mines", "35": "Social Justice and Empowerment", "36": "Tribal Affairs",
    "37": "D/o Commerce (Supply Division)", "38": "Shipping and Road Transport and Highways",
    "39": "Urban Development, Urban Employment and Poverty Alleviation", "40": "Water Resources",
    "41": "President's Secretariat", "42": "Lok Sabha Secretariat", "43": "Rajya Sabha secretariat",
    "44": "Election Commission", "45": "Ministry of Defence (Controller General of Defence Accounts)",
    "46": "Ministry of Railways", "47": "Department of Posts", "48": "Department of Telecommunications",
    "49": "Andaman and Nicobar Islands Administration", "50": "Chandigarh Administration",
    "51": "Dadra and Nagar Haveli", "52": "Goa, Daman and Diu", "53": "Lakshadweep", "54": "Pondicherry Administration",
    "55": "Pay and Accounts Officers (Audit)", "56": "Ministry of Non-conventional energy sources",
    "57": "Government Of NCT of Delhi", "99": "Others"},
  // Annexure 4: deductor / collector category
  CATEGORY: {A: "Central Government", S: "State Government", D: "Statutory body (Central Govt.)", E: "Statutory body (State Govt.)",
    G: "Autonomous body (Central Govt.)", H: "Autonomous body (State Govt.)", L: "Local Authority (Central Govt.)", N: "Local Authority (State Govt.)",
    K: "Company", M: "Branch / Division of Company", P: "Association of Person (AOP)", T: "Association of Person (Trust)", J: "Artificial Juridical Person",
    B: "Body of Individuals", Q: "Individual/HUF", F: "Firm"},
  // Annexure 2 of each workbook: the section codes a deduction (collection) record may carry
  CODES: {
    "24Q": ["1001", "1002", "1003", "1032"],
    "26Q": ["1004", "1005", "1006", "1008", "1009", "1011", "1012", "1013", "1014", "1015", "1016", "1017", "1018", "1019", "1020", "1021", "1022",
      "1023", "1024", "1026", "1027", "1028", "1029", "1030", "1031", "1033", "1034", "1035", "1037", "1038", "1058", "1059", "1060", "1061", "1062",
      "1063", "1064", "1065", "1066", "1067"],
    "27Q": ["1004", "1039", "1040", "1041", "1042", "1043", "1044", "1045", "1046", "1047", "1048", "1049", "1050", "1051", "1052", "1053", "1054",
      "1055", "1056", "1057", "1058", "1059", "1060", "1061", "1062", "1063", "1064", "1065", "1066", "1067"],
    "27EQ": ["1068", "1069", "1070", "1071", "1072", "1073", "1074", "1075", "1076", "1077", "1078", "1079", "1080", "1081", "1082", "1083", "1084",
      "1085", "1086", "1087", "1088", "1089", "1090", "1091", "1092"]
  },
  // Annexure 6: the section codes each remark FinCom writes (A: certificate, C: higher rate, no PAN) is allowed with.
  // Form 138 and Form 143: A and C with every code of the form. Form 140: every code. Form 144: every code but 1059, 1061.
  FLAG_CODES: {"27Q": {A: ["1004", "1039", "1040", "1041", "1042", "1043", "1044", "1045", "1046", "1047", "1048", "1049", "1050", "1051", "1052",
    "1053", "1054", "1055", "1056", "1057", "1058", "1060", "1062", "1063", "1064", "1065", "1066", "1067"]}},
  // codes whose deductee record must have a real PAN (DD field 8, Forms 140 and 144) and carries tax and rate 0.00
  NO_DEFAULT_PAN: {"26Q": ["1059", "1034", "1038", "1061"], "27Q": ["1059", "1061"]},
  // Form 144 Annexure 9: the nature-of-remittance codes allowed for each section code that needs one (DD field 16); a
  // section code not listed takes no nature code. Read off the workbook in its row order (a row without a section code
  // belongs to the one above it).
  NATURE_144: {"1040": ["27"], "1041": ["27"], "1042": ["27"], "1043": ["27"], "1044": ["27"], "1045": ["27"], "1046": ["16", "73"],
    "1048": ["27", "16", "73", "66", "67", "68", "69", "70"], "1049": ["27", "16", "73", "66", "67", "68", "69", "70"],
    "1050": ["27", "16", "73", "66", "67", "68", "69", "70"], "1051": ["27", "16", "73"], "1052": ["71"], "1053": ["27", "16", "73"], "1054": ["72"],
    "1055": ["27", "16", "73", "66", "67", "68", "69", "70"], "1056": ["27", "16", "73", "66", "67", "68", "69", "70"],
    "1057": ["27", "73", "16", "28", "66", "67", "68", "69", "70", "21", "74", "49", "75", "99"]},
  // Form 144 DD fields 37, 38, 39, 41 (address, e-mail, contact number, tax identification number in the country of
  // residence). The workbook's words (field 37's remarks) are not what Protean's FVU 1.2 (17-Aug-2026) does: it takes these
  // fields only with remark C and no PAN (PANNOTAVBL / PANAPPLIED / PANINVALID) and one of these natures of remittance, and
  // needs them then when the rate is below 20% (T-FV-4335 to 4343, read from FVU 1.2); in every other case they must be
  // empty. FinCom follows FVU 1.2 (docs/tds-forms-2025/GAPS.md, a question for the owner).
  NATURE_CONTACT: ["05", "06", "07", "10", "11", "12", "13", "14", "16", "17"],
  // Form 144 Annexure 10: country codes
  COUNTRIES: {
    "AFGHANISTAN": "01", "AKROTIRI": "02", "ALBANIA": "03", "ALGERIA": "04", "AMERICAN SAMOA": "05", "ANDORRA": "06",
    "ANGOLA": "07", "ANGUILLA": "08", "ANTARCTICA": "09", "ANTIGUA AND BARBUDA": "10", "ARGENTINA": "11",
    "ARMENIA": "12", "ARUBA": "13", "ASHMORE AND CARTIER ISLANDS": "14", "AUSTRALIA": "15", "AUSTRIA": "16",
    "AZERBAIJAN": "17", "BAHRAIN": "18", "BAILIWICK OF GUERNSEY": "19", "BAILIWICK OF JERSEY": "20",
    "BAKER ISLAND": "21", "BANGLADESH": "22", "BARBADOS": "23", "BELARUS": "24", "BELGIUM": "25", "BELIZE": "26",
    "BENIN PORTO": "27", "BERMUDA": "28", "BHUTAN": "29", "BOLIVIA": "30", "BOSNIAAND HERZEGOVINA": "31",
    "BOTSWANA": "32", "BOUVET ISLAND": "33", "BRAZIL": "34", "BRITISH INDIAN OCEAN TERRITORY": "35", "BRUNEI": "36",
    "BULGARIA": "37", "BURKINA FASO": "38", "BURUNDI": "39", "CAMBODIA": "40", "CAMEROON": "41", "CANADA": "42",
    "CAPE VERDE": "43", "CAYMAN ISLANDS": "44", "CENTRAL AFRICAN REPUBLIC": "45", "CHAD": "46", "CHILE": "47",
    "CHINA": "48", "CHRISTMAS ISLAND": "49", "CLIPPERTON ISLAND": "50", "COCOS (KEELING) ISLANDS": "51",
    "COLOMBIA": "52", "COMMONWEALTH OF PUERTO RICO": "53", "COMMONWEALTH OF THE NORTHERN MARIANA ISLANDS": "54",
    "COMOROS": "55", "CONGO,DEMOCRATIC REPUBLIC OF THE": "56", "CONGO,REPUBLIC OF THE": "57", "COOK ISLANDS": "58",
    "CORAL SEA ISLANDS": "59", "CORAL SEA ISLANDS TERRITORY": "60", "COSTA RICA": "61", "COTE D'IVOIRE": "62",
    "CROATIA": "63", "CUBA": "64", "CYPRUS": "65", "CZECH REPUBLIC": "66", "DENMARK": "67",
    "DEPARTMENTAL COLLECTIVITY OF MAYOTTE": "68", "DHEKELIA": "69", "DJIBOUTI": "70", "DOMINICA": "71",
    "DOMINICAN REPUBLIC": "72", "EAST TIMOR (TIMORLASTE)": "73", "ECUADOR": "74", "EGYPT": "75", "ELSALVADOR": "76",
    "EQUATORIAL GUINEA": "77", "ERITREA": "78", "ESTONIA": "79", "ETHIOPIA": "80",
    "FALKLAND ISLANDS (ISLAS MALVINAS)": "81", "FAROE ISLANDS": "82", "FIJI": "83", "FINLAND": "84", "FRANCE": "85",
    "FRENCH GUIANA": "86", "FRENCH POLYNESIA": "87", "FRENCH SOUTHERN ISLANDS": "88", "GABON": "89", "GEORGIA": "90",
    "GERMANY": "91", "GEURNSEY": "92", "GHANA": "93", "GIBRALTAR": "94", "GREECE": "95", "GREENLAND": "96",
    "GRENADA": "97", "GUADELOUPE": "98", "GUAM": "100", "GUATEMALA": "101", "GUERNSEY": "102", "GUINEA": "103",
    "GUINEABISSAU": "104", "GUYANA": "105", "HAITI": "106", "HEARD ISLAND AND MCDONALD ISLANDS": "107",
    "HONDURAS": "108", "HONG KONG": "109", "HOWLAND ISLAND": "110", "HUNGARY": "111", "ICELAND": "112", "INDIA": "113",
    "INDONESIA": "114", "IRAN": "115", "IRAQ": "116", "IRELAND": "117", "ISLE OF MAN": "118", "ISRAEL": "119",
    "ITALY": "120", "JAMAICA": "121", "JAN MAYEN": "122", "JAPAN": "123", "JARVIS ISLAND": "124", "JERSEY": "125",
    "JOHNSTON ATOLL": "126", "JORDAN": "127", "KAZAKHSTAN": "128", "KENYA": "129", "KINGMAN REEF": "130",
    "KIRIBATI": "131", "KOREA, NORTH": "132", "KOREA, SOUTH": "133", "KOSOVO": "134", "KUWAIT": "135",
    "KYRGYZSTAN": "136", "LAOS": "137", "LATVIA": "138", "LEBANON": "139", "LESOTHO": "140", "LIBERIA": "141",
    "LIBYA": "142", "LIECHTENSTEIN": "143", "LITHUANIA": "144", "LUXEMBOURG": "145", "MACAU": "146", "MACEDONIA": "147",
    "MADAGASCAR": "148", "MALAWI": "149", "MALAYSIA": "150", "MALAYSIA (LABUAN)": "151", "MALDIVES": "152",
    "MALI": "153", "MALTA": "154", "MARSHALLISLANDS": "155", "MARTINIQUE": "156", "MAURITANIA": "157",
    "MAURITIUS": "158", "MAYOTTE": "159", "UNITED MEXICAN STATES": "160", "MICRONESIA, FEDERATED STATES OF": "161",
    "MIDWAY ISLANDS": "162", "MOLDOVA": "163", "MONACO": "164", "MONGOLIA": "165", "MONTENEGRO": "166",
    "MONTSERRAT": "167", "MOROCCO": "168", "MOZAMBIQUE": "169", "MYANMAR (BURMA)": "170", "NAMIBIA": "171",
    "NAURU": "172", "NAVASSA ISLAND": "173", "NEPAL": "174", "NETHERLANDS": "175", "NETHERLANDS ANTILLES": "176",
    "NEW CALEDONIA": "177", "NEWZEALAND": "178", "NICARAGUA": "179", "NIGER": "180", "NIGERIA": "181", "NIUE": "182",
    "NORFOLK ISLAND": "183", "NORTHERN MARIANA ISLANDS": "184", "NORWAY": "185", "OMAN": "186", "PAKISTAN": "187",
    "PALAU": "188", "PALMYRA ATOLL": "189", "PANAMA": "190", "PAPUA NEW GUINEA": "191", "PARACEL ISLANDS": "192",
    "PARAGUAY": "193", "PERU": "194", "PHILIPPINES": "195", "PITCAIRN ISLANDS": "196",
    "PITCAIRN, HENDERSON, DUCIE, AND OENO ISLANDS": "197", "POLAND": "198", "PORTUGAL": "199", "PUERTO RICO": "200",
    "QATAR": "201", "REUNION": "202", "ROMANIA": "203", "RUSSIA": "204", "RWANDA": "205", "SAINT BARTHELEMY": "206",
    "SAINT HELENA": "207", "SAINT KITTS AND NEVIS": "208", "SAINT LUCIA": "209", "SAINT MARTIN": "210",
    "SAINT PIERRE AND MIQUELON": "211", "SAINT VINCENT AND THE GRENADINES": "212", "SAMOA": "213", "SANMARINO": "214",
    "SAO TOME AND PRINCIPE": "215", "SAUDI ARABIA": "216", "SENEGAL": "217", "SERBIA": "218", "SEYCHELLES": "219",
    "SIERRA LEONE": "220", "SINGAPORE": "221", "SLOVAKIA": "222", "SLOVENIA": "223", "SOLOMON ISLANDS": "224",
    "SOMALIA": "225", "SOUTH AFRICA": "226", "SOUTH GEORGIA AND SOUTH SANDWICH ISLANDS": "227", "SPRATLY ISLANDS": "228",
    "SPAIN": "229", "SRI LANKA": "230", "ST. VINCENT & GRENADINES": "231", "SUDAN": "232", "SURINAME": "233",
    "SVALBARD": "234", "SWAZILAND": "235", "SWEDEN": "236", "SWITZERLAND": "237", "SYRIA": "238", "TAIWAN": "239",
    "TAJIKISTAN": "240", "TANZANIA": "241", "TERRITORIAL COLLECTIVITY OF ST. PIERRE & MIQUELON": "242",
    "TERRITORY OF AMERICAN SAMOA": "243", "TERRITORY OF ASHMORE AND CARTIER ISLANDS": "244",
    "TERRITORY OF CHRISTMAS ISLAND": "245", "TERRITORY OF COCOS (KEELING) ISLANDS": "246", "TERRITORY OF GUAM": "247",
    "TERRITORY OF HEARD ISLAND & MCDONALD ISLANDS": "248", "TERRITORY OF NORFOLK ISLAND": "249", "THAILAND": "250",
    "THE BAHAMAS": "251", "THE GAMBIA": "252", "TOGO": "253", "TOKELAU": "254", "TONGA": "255",
    "TRINIDAD AND TOBAGO": "256", "TUNISIA": "257", "TURKEY": "258", "TURKMENISTAN": "259",
    "TURKS AND CAICOS ISLANDS": "260", "TUVALU": "261", "UGANDA": "262", "UKRAINE": "263", "UNITED ARAB EMIRATES": "264",
    "UNITED KINGDOM": "265", "UNITED STATES VIRGIN ISLANDS": "266", "UNITED STATES OF AMERICA": "267", "URUGUAY": "268",
    "UZBEKISTAN": "269", "VANUATU": "270", "VATICAN CITY (HOLYSEE)": "271", "VENEZUELA": "272", "VIETNAM": "273",
    "VIRGIN ISLANDS, BRITISH": "274", "VIRGIN ISLANDS, U.S.": "275", "WAKE ISLAND": "276", "WALLIS AND FUTUNA": "277",
    "WESTERN SAHARA": "278", "YEMEN": "279", "ZAMBIA": "280", "ZIMBABWE": "281", "COMBODIA": "282", "CONGO": "283",
    "IVORY COAST": "284", "WEST INDIES": "285", "BRITISH VIRGIN ISLANDS": "286"},
  COUNTRY_ALIAS: {"USA": "UNITED STATES OF AMERICA", "US": "UNITED STATES OF AMERICA", "UNITED STATES": "UNITED STATES OF AMERICA", "UK": "UNITED KINGDOM",
    "GREAT BRITAIN": "UNITED KINGDOM", "UAE": "UNITED ARAB EMIRATES", "MEXICO": "UNITED MEXICAN STATES", "NEW ZEALAND": "NEWZEALAND", "SAN MARINO": "SANMARINO"},
  // Form 143 Annexure 8 (collectee code) and Form 144 Annexure 8 (status), from the PAN's fourth letter where the PAN says
  // it without doubt: C company 1, P individual 2, H HUF 3, F firm 7, B body of individuals 8, J artificial juridical
  // person 9. An A (association of persons: 4, 5, or a co-operative society 6), T, G, L, K PAN is for a person to say.
  STATUS_BY_PAN: {C: "1", P: "2", H: "3", F: "7", B: "8", J: "9"},
  // the deductor's category (BH field 32) from its own PAN's fourth letter where that says it without doubt; a branch of a
  // company (M), a government or local body is for a person to say (co.tds26q.deductorType)
  CATEGORY_BY_PAN: {C: "K", F: "F", P: "Q", H: "Q", A: "P", T: "T", B: "B", J: "J"},
  GOVT: /^[ASDEGHLN]$/,

  // one record: n fields, each value at its field number (1-based), the rest empty; "^" between them (n - 1 of them)
  rec(n, at){
    const a = new Array(n).fill("");
    Object.keys(at).forEach(k => { const v = at[k]; if (+k >= 1 && +k <= n) a[+k - 1] = v == null ? "" : String(v); });
    return a.join("^");
  },
  // printable ASCII, no caret, single spaces
  ascii(v){ return String(v == null ? "" : v).replace(/[\^\r\n\t]/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim(); },
  norm(v){ return this.ascii(v).toUpperCase().replace(/\s*&\s*/g, " & ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim(); },
  stateCode(v){
    const s = this.ascii(v);
    if (!s) return "";
    if (/^\d{1,2}$/.test(s)){ const c = s.padStart(2, "0"); return Object.values(this.STATES).includes(c) ? c : ""; }
    const n = this.norm(s), key = Object.keys(this.STATES).find(k => k === n) || this.STATE_ALIAS[n] || this.STATE_ALIAS[n.replace(/ & /g, " AND ")];
    return key ? this.STATES[key] : "";
  },
  countryCode(v){
    const s = this.ascii(v);
    if (!s) return "";
    const codes = Object.values(this.COUNTRIES);
    if (/^\d{1,3}$/.test(s)){ const n = String(+s); return codes.find(c => String(+c) === n) || ""; }
    const n = this.norm(s), key = this.COUNTRIES[n] ? n : this.COUNTRY_ALIAS[n];
    return key ? this.COUNTRIES[key] || "" : "";
  },
  panLetter(p){ const P = String(p || "").toUpperCase(); return Certs.validPan(P) ? P[3] : ""; },
  dmy(s){ const y = TDS.ymd(s); return y ? y.slice(6, 8) + y.slice(4, 6) + y.slice(0, 4) : ""; },
  money(v){ return r2(num(v)).toFixed(2); },
  // Assessment Yr and Tax Year of the batch header (fields 16, 17): tax year 2026-27 is 202627, its assessment year 202728
  years(fy){ const y = num(String(fy).slice(0, 4)); return {ay: String(y + 1) + String(y + 2).slice(2), ty: String(y) + String(y + 1).slice(2)}; },

  // the statement of the quarter before, for BH field 52 ("Whether regular statement for Form … filed for earlier period")
  // and field 9 (its 15-digit token). The first quarter of the new forms (tax year 2026-27 Q1) has none; for a later quarter
  // the quarter before as marked filed in FinCom (TDSFiled), or what the deductor's details say (prevFiled, prevToken).
  previous(fy, q, form, firm){
    if (firm.prevFiled === "Y" || firm.prevFiled === "N") return {flag: firm.prevFiled, token: String(firm.prevToken || "").replace(/\s/g, ""), how: "given"};
    const Q = ["Q1", "Q2", "Q3", "Q4"], i = Q.indexOf(q);
    if (fy === TDS.NEW_FROM && i === 0) return {flag: "N", token: "", how: "first"};
    const y = num(fy.slice(0, 4)), pfy = i ? fy : (y - 1) + "-" + String(y).slice(2), pq = i ? Q[i - 1] : "Q4";
    const f = typeof TDSFiled === "object" ? TDSFiled.get(pfy, pq, form) : null;
    if (f && f.on) return {flag: "Y", token: String(f.token || "").replace(/\s/g, ""), how: "filed", pfy, pq};
    return {flag: "N", token: "", how: "not marked", pfy, pq};
  },

  // the file: {text, name, rows, challans, problems, notes, ...} or {error}
  build(fy, q, firm, form){
    if (!TDS.isNew(fy)) return {error: "Forms 138, 140, 143 and 144 are for tax year " + TDS.NEW_FROM + " on."};
    if (!this.FILE_TYPE[form]) return {error: "Unknown form " + form + "."};
    if (form === "24Q" && q === "Q4")
      return {error: "Protean has not yet released the Q4 layout for Form 138"};
    firm = firm || {};
    const fno = TDS.formNo(form, fy), problems = [], notes = [], missing = new Set(), P = (w) => { if (!problems.includes(w)) problems.push(w); };
    // a value cut to its size; what is missing or too long is named once, by deductorProblems
    const fit = (v, n) => this.ascii(v).slice(0, n);
    // the deductions (collections) of the quarter that are against a challan, with the challans they use
    const data = this.rowsOf(fy, q, form);
    if (data.error) return data;
    const {rows, live, used} = data;
    const yrs = this.years(fy), prev = this.previous(fy, q, form, firm);
    if (prev.flag === "Y" && !/^\d{15}$/.test(prev.token)) P("Form " + fno + " of " + (prev.pq || "the quarter before") + " " + (prev.pfy || "") + " is marked filed but its 15-digit token number is not given: BH field 9 needs it.");
    if (prev.how === "not marked") notes.push("Form " + fno + " of " + prev.pq + " " + prev.pfy + " is not marked filed in FinCom, so the file says no earlier regular statement (BH field 52 “N”). If it was filed, mark it filed with its token first.");
    // the deductor (collector): Client setup → TDS (co.tds26q), checked by the same function the screen uses
    this.deductorProblems(firm).forEach(p => P(p.why));
    const pan = String(firm.pan || "").toUpperCase(), cat = this.categoryFor(firm);
    if (!firm.deductorType && cat) notes.push("The deductor's category \u201c" + cat + "\u201d (" + this.CATEGORY[cat] + ") is read from its PAN's fourth letter.");
    const govt = this.GOVT.test(cat), tan = String(firm.tan || "").toUpperCase();
    const st = this.stateCode(firm.state), pst = this.stateCode(firm.personState || firm.state);
    const pin = this.ascii(firm.pin), ppin = this.ascii(firm.personPin || firm.pin);
    const email = this.ascii(firm.email), pemail = this.ascii(firm.personEmail);
    const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "");
    const phone = digits(firm.phone), pphone = digits(firm.personPhone || firm.phone);
    const ppan = String(firm.personPan || "").toUpperCase(), gstin = this.ascii(firm.gstin || firm.gstinOwn).toUpperCase();
    const ascii = this.ascii.bind(this);
    // address lines (Annexure: Flat/Door/Block, Post Office, Road/Street/Block/Sector, Area/locality, District)
    const addr = (o) => { const a = this.addrLines(o); return {1: fit(a[1], 25), 2: fit(a[2], 25), 3: fit(a[3], 25), 4: fit(a[4], 25), 5: fit(a[5], 25)}; };
    const da = addr(firm), pa = addr(this.personAddr(firm));
    const lines = [];
    let ln = 0;
    const put = (n, at) => { ln++; at[1] = ln; lines.push(this.rec(n, at)); };
    const fileDate = (() => { const d = new Date(); return String(d.getDate()).padStart(2, "0") + String(d.getMonth() + 1).padStart(2, "0") + d.getFullYear(); })();
    // FH: one for the file
    put(this.FIELDS.FH, {2: "FH", 3: this.FILE_TYPE[form], 4: "R", 5: fileDate, 6: "1", 7: "D", 8: tan, 9: "1", 10: "FinCom"});
    // the challans as deposited (Part B, columns B to F, from the challan: Note 6 “the exact amount deposited”)
    const ch = live.map((c, ci) => {
      const mine = used[c.id];
      const B = r2(num(c.tax)), C = r2(num(c.interest)), D = r2(num(c.fee)), E = r2(num(c.others)), F = r2(B + C + D + E);
      [[B, "tax"], [C, "interest"], [D, "fee"], [E, "penalty / others"]].forEach(([v, w]) => { if (Math.round(v * 100) % 100) P("Challan " + c.bsr + "/" + c.serial + ": its " + w + " " + this.money(v) + " has paise; the challan record takes whole rupees."); });
      const dep = r2(mine.reduce((a, r) => a + num(r.tds), 0));
      if (Math.round(dep * 100) > Math.round(B * 100)) P("Challan " + c.bsr + "/" + c.serial + ": the tax of its deductions (" + this.money(dep) + ") is more than the challan's tax (" + this.money(B) + ").");
      if (!/^\d{7}$/.test(String(c.bsr || ""))) P("Challan " + (c.bsr || "?") + "/" + (c.serial || "?") + ": the BSR code is not 7 digits.");
      if (!/^\d{1,5}$/.test(String(c.serial || ""))) P("Challan " + (c.bsr || "?") + "/" + (c.serial || "?") + ": the challan serial number is not up to 5 digits.");
      // a Government deductor's transfer by book adjustment (Part B column G \u201cB\u201d, Note 7): the challan marked so
      // (c.mode "B"); its H is the Form 24G receipt number, J the DDO serial number. Every other deposit is by challan, \u201cC\u201d
      const book = String(c.mode || "").toUpperCase() === "B";
      if (book && !govt) P("Challan " + c.bsr + "/" + c.serial + " is marked as a book adjustment, which only a Government deductor makes.");
      // FVU 1.2 (T_FV_3157): a transfer voucher is dated the last day of its month
      if (book){ const d = TDS.ymd(c.date), y = +d.slice(0, 4), m = +d.slice(4, 6); if (+d.slice(6, 8) !== new Date(Date.UTC(y, m, 0)).getUTCDate()) P("Transfer voucher " + c.bsr + "/" + c.serial + ": its date must be the last day of the month (FVU 1.2).");}
      if (book && /^[AS]$/.test(cat) && !/^\d{7}$/.test(String(firm.ain || ""))) P("A book adjustment by a Central or State Government deductor needs the AIN of the PAO / DTO / CDDO (BH field 68, 7 digits).");
      // next-challan-match (the owner, 17-Oct-2026; GAPS.md Q2): fields 24 and 25 are the interest and the others ALLOCATED
      // to this statement (the register's portion, TDSReg.portionFor), 0.00 when none; the challan as deposited stays in
      // fields 8 to 12. The fee portion is fee and others together, the fee first: the others' part of it goes to 25
      const part = typeof TDSReg === "object" ? TDSReg.portionFor(c, form, fy, q) : {interest: 0, fee: 0};
      // (next-tds-interest: interest or fee allocated past the challan's own comes from its tax not used, TDSReg.setPortion:
      // written as allocated, not cut to fields 9 and 11)
      const aI = r2(num(part.interest)), aE = r2(Math.max(0, num(part.fee) - D));
      [[aI, "interest allocated"], [aE, "others allocated"]].forEach(([v, w]) => { if (Math.round(v * 100) % 100) P("Challan " + c.bsr + "/" + c.serial + ": its " + w + " " + this.money(v) + " has paise; the challan record takes whole rupees."); });
      return {c, mine, B, C, D, E, F, dep, no: ci + 1, book, aI, aE};
    });
    const batchTotal = r2(ch.reduce((a, x) => a + x.F, 0));
    // BH: one batch for the form and quarter
    put(this.FIELDS.BH, {2: "BH", 3: "1", 4: String(live.length), 5: fno, 9: prev.flag === "Y" ? prev.token : "", 13: tan, 15: govt && !Certs.validPan(pan) ? "PANNOTREQD" : pan,
      16: yrs.ay, 17: yrs.ty, 18: q, 19: fit(firm.name, 75), 20: fit(firm.country || "INDIA", 25),
      21: da[1], 22: da[2], 23: da[3], 24: da[4], 25: da[5], 26: st, 27: pin, 28: email.slice(0, 75), 29: digits(firm.phoneCc || "91"), 30: phone,
      32: cat, 33: fit(firm.person, 75), 34: fit(firm.personDesignation, 20),
      35: pa[1], 36: pa[2], 37: pa[3], 38: pa[4], 39: pa[5], 40: pst, 41: ppin, 42: pemail.slice(0, 75),
      43: fit(firm.personCountry || firm.country || "INDIA", 25), 44: digits(firm.personPhoneCc || firm.phoneCc || "91"), 45: pphone,
      // field 49 (Count of Salary Details Records): the workbook says 'Not applicable', but Protean's FVU 1.2 (17-Aug-2026)
      // refuses a Form 138 file without it (T-FV-2127) and the RPU sample writes 0: 0 for Q1 to Q3 (no salary records)
      47: this.money(batchTotal), 49: form === "24Q" ? "0" : "", 52: prev.flag, 54: govt && /^[SEHN]$/.test(cat) ? this.stateCode(firm.stateName || firm.state) : "",
      57: govt ? ascii(firm.ministry).slice(0, 3) : "", 58: govt && ascii(firm.ministry) === "99" ? fit(firm.ministryOther, 150) : "",
      59: ppan, 68: govt && ch.some(x => x.book) ? ascii(firm.ain).slice(0, 7) : "", 69: gstin});
    // CD and its DD: deductee records numbered from 1 under each challan. The workbooks do not say it plainly (Form 144:
    // "in a batch"); Protean's FVU 1.2 refuses numbering through the batch (T-FV-4007 "not in sequence") on a second challan
    ch.forEach(x => {
      let dno = 0;
      const {c, mine} = x;
      put(this.FIELDS.CD, {2: "CD", 3: "1", 4: String(x.no), 5: String(mine.length), 6: "N", 8: this.money(x.B), 9: this.money(x.C), 10: this.money(x.D),
        11: this.money(x.E), 12: this.money(x.F), 13: x.book ? "B" : "C", 15: String(c.bsr || ""), 17: String(c.serial || ""), 19: this.dmy(c.date),
        21: this.money(x.dep), 22: this.money(mine.reduce((a, r) => a + num(r.tds), 0)), 23: x.book ? String(c.minorHead || "") : String(c.minorHead || "200"),
        24: this.money(x.aI), 25: this.money(x.aE)});
      mine.forEach(r => {
        dno++;
        const d = this.ddOf(r, form, fy, q, firm, cat, c, problems, missing, P);
        put(this.FIELDS.DD, Object.assign({2: "DD", 3: "1", 4: String(dno), 5: String(x.no), 6: "O"}, d));
      });
    });
    const draft = typeof NEW_FORMS_VALIDATED === "undefined" || !NEW_FORMS_VALIDATED;
    return {text: lines.join("\r\n") + "\r\n", rows: rows.length, challans: live.length, form, formNo: fno, isNew: true, draft,
      name: (tan || "TAN") + "_Form" + fno + "_" + q + "_" + fy.replace("-", "") + (draft ? "_DRAFT" : "") + ".txt",
      missingCodes: Array.from(missing), problems, notes, format: this.FORMAT,
      remarks: lines.filter(l => /^\d+\^DD\^/.test(l) && l.split("^")[31]).length, salaryRecords: 0,
      words: "Built to " + this.FORMAT + "; check it with Protean's FVU before filing."};
  },

  // the deductor's category (Annexure 4): as chosen in Client setup → TDS, else from its PAN's fourth letter
  categoryOf(pan){ return this.CATEGORY_BY_PAN[this.panLetter(pan)] || ""; },
  categoryFor(firm){ return String((firm || {}).deductorType || "").toUpperCase() || this.categoryOf((firm || {}).pan); },
  // address lines 1 to 5 (Flat/Door/Block; Post Office; Road/Street/Block/Sector; Area/locality; District)
  addrLines(o){ const a = this.ascii.bind(this); return {1: a(o.flat), 2: a(o.postOffice), 3: [o.premises, o.road].map(a).filter(Boolean).join(", "), 4: a(o.area), 5: a(o.town)}; },
  personAddr(f){ return {flat: f.personFlat, postOffice: f.personPostOffice, premises: f.personPremises, road: f.personRoad, area: f.personArea, town: f.personTown}; },
  // the deductor's details as the batch header needs them (the workbook, BH fields 13-59, 68, 69): [{k, why}], k the key in
  // co.tds26q (or tan, pan, name of the client); one function for the screen (Client setup → TDS) and the files
  deductorProblems(firm){
    firm = firm || {};
    const out = [], P = (k, why) => out.push({k, why}), a = (v) => this.ascii(v);
    const pan = String(firm.pan || "").toUpperCase(), cat = this.categoryFor(firm), govt = this.GOVT.test(cat);
    if (!/^[A-Z]{4}\d{5}[A-Z]$/.test(String(firm.tan || "").toUpperCase())) P("tan", "The deductor's TAN is missing or not a valid TAN (4 letters, 5 digits, a letter).");
    if (!cat) P("deductorType", "The deductor's category (Annexure 4) is not known: choose it.");
    else if (!this.CATEGORY[cat]) P("deductorType", "The deductor's category \u201c" + cat + "\u201d is not one of Annexure 4.");
    if (!Certs.validPan(pan) && !(govt && pan === "PANNOTREQD")) P("pan", "The deductor's PAN is missing or not a valid PAN" + (govt ? " (a Government deductor writes PANNOTREQD)" : "") + ".");
    if (!a(firm.name)) P("name", "The deductor's name is missing.");
    else if (a(firm.name).length > 75) P("name", "The deductor's name is longer than 75 characters.");
    const lines = (o, who, pre) => { const L = this.addrLines(o); if (!L[1]) P(pre + "flat", who + " address line 1 (flat, door, block) is missing.");
      [[1, "flat"], [2, "postOffice"], [3, "road"], [4, "area"], [5, "town"]].forEach(([n, k]) => { if (L[n].length > 25) P(pre + k, who + " address line " + n + " is longer than 25 characters (\u201c" + L[n] + "\u201d)" + (n === 3 ? ": building and road together." : ".")); }); };
    lines(firm, "The deductor's", "");
    lines(this.personAddr(firm), "The responsible person's", "person");
    const pk = (k) => "person" + k[0].toUpperCase() + k.slice(1);
    if (!this.stateCode(firm.state)) P("state", "The deductor's state is missing or not one of Annexure 1" + (firm.state ? " (\u201c" + a(firm.state) + "\u201d)" : "") + ".");
    if (!this.stateCode(firm.personState || firm.state)) P("personState", "The responsible person's state is missing or not one of Annexure 1.");
    if (!/^\d{6}$/.test(a(firm.pin))) P("pin", "The deductor's PIN code is missing or not 6 digits.");
    if (!/^\d{6}$/.test(a(firm.personPin || firm.pin))) P("personPin", "The responsible person's PIN code is missing or not 6 digits.");
    const okMail = (m) => /^[^@\s^]+@[^@\s^]+\.[^@\s^]+$/.test(m) && /[^@.]$/.test(m) && m.length <= 75;
    const email = a(firm.email), pemail = a(firm.personEmail);
    if (!email && !pemail) P("email", "An e-mail of the deductor or of the responsible person is needed.");
    if (email && !okMail(email)) P("email", "The deductor's e-mail \u201c" + email + "\u201d is not a valid e-mail.");
    if (pemail && !okMail(pemail)) P("personEmail", "The responsible person's e-mail \u201c" + pemail + "\u201d is not a valid e-mail.");
    const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "");
    [["phoneCc", "The deductor's"], ["personPhoneCc", "The responsible person's"]].forEach(([k, who]) => { const v = firm[k]; if (v != null && v !== "" && !/^\d{1,5}$/.test(digits(v))) P(k, who + " country code is up to 5 digits."); });
    const phone = digits(firm.phone), pphone = digits(firm.personPhone || firm.phone);
    if (!phone || phone.length > 10) P("phone", "The deductor's contact number is missing or longer than 10 digits (without the country code).");
    if (!pphone || pphone.length > 10) P("personPhone", "The responsible person's mobile number is missing or longer than 10 digits (without the country code).");
    if (!a(firm.person)) P("person", "The name of the person responsible is missing.");
    else if (a(firm.person).length > 75) P("person", "The name of the person responsible is longer than 75 characters.");
    if (!a(firm.personDesignation)) P("personDesignation", "The responsible person's designation is missing.");
    else if (a(firm.personDesignation).length > 20) P("personDesignation", "The responsible person's designation is longer than 20 characters.");
    if (!Certs.validPan(String(firm.personPan || "").toUpperCase())) P("personPan", "The PAN of the person responsible (BH field 59) is missing or not a valid PAN.");
    [["country", "The deductor's"], ["personCountry", "The responsible person's"]].forEach(([k, who]) => { if (a(firm[k]).length > 25) P(k, who + " country is longer than 25 characters."); });
    if (govt && /^[SEHN]$/.test(cat) && !this.stateCode(firm.stateName || firm.state)) P("stateName", "A State Government deductor gives its State (Annexure 5).");
    if (govt && /^[ADG]$/.test(cat) && !/^\d{2}$/.test(a(firm.ministry))) P("ministry", "A Central Government deductor gives its Ministry code (Annexure 3, two digits).");
    if (govt && a(firm.ministry) === "99" && !a(firm.ministryOther)) P("ministryOther", "Ministry \u201cOthers\u201d (99): give the Ministry's name.");
    if (firm.ain && !/^\d{7}$/.test(a(firm.ain))) P("ain", "The AIN of the PAO / DTO / CDDO is 7 digits.");
    const gstin = a(firm.gstin || firm.gstinOwn).toUpperCase();
    if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) P("gstin", "The GSTIN \u201c" + gstin + "\u201d is not 15 characters.");
    return out;
  },

  // the rows of the return that are on a challan, and the challans: as the old builders choose them (the quarter's own
  // challans and any other that pays this return's deductions)
  // next-challan-match: a deduction with tax on no challan stops the file with the list (TDS26Q.untaggedError), never left
  // out silently; Form 138's rows are TDS24Q_FILE.rowsOf's (Tally's payroll, else the salary sheet)
  rowsOf(fy, q, form){
    let rows;
    if (form === "24Q"){
      const s = TDS24Q_FILE.rowsOf(fy, q);
      if (s.error) return s;
      rows = s.rows.filter(r => r.tds > 0.005).map(r => Object.assign({}, r, {party: r.employee || r.party}));
    } else {
      const all = TDS_FORMS[form].rows().filter(r => r.fy === fy && r.q === q), un = TDS26Q.untaggedError(all, form === "27EQ");
      if (un) return un;
      rows = all.filter(r => r.challan);
    }
    const used = {};
    rows.forEach(r => { (used[r.challan] = used[r.challan] || []).push(r); });
    const live = TDS.challans().filter(c => (used[c.id] || []).length).sort((a, b) => String(TDS.ymd(a.date)).localeCompare(String(TDS.ymd(b.date))));
    if (!live.length) return {error: form === "24Q" ? "No salary TDS of " + q + " " + fy + " is tagged to a challan yet."
      : "No challan for " + q + " " + fy + " has " + (form === "27EQ" ? "collections" : "deductions") + " in Form " + TDS.formNo(form, fy) + " against it yet."};
    const useAll = TDS.challanUse(), over = live.filter(c => Math.round((useAll[c.id] || 0) * 100) > Math.round(num(c.tax) * 100));
    if (over.length) return {error: "Challan " + over.map(c => c.bsr + "/" + c.serial).join(", ") + " has more deductions against it than its amount. Take some off it first (Entries, tick them, Untag)."};
    return {rows, live, used};
  },

  // the section code of a deduction for the new form: Form 138 by the deductor's category (Annexure 2: 1001 State
  // Government employees, 1002 other than Government employees, 1003 Union Government employees); the others from the one
  // table (PAY_CODES, src/js/16)
  sectionCode(r, form, cat, firm){
    if (form === "24Q"){
      if (cat === "A") return {code: "1003", why: ""};
      if (cat === "S") return {code: "1001", why: ""};
      if (/^[KMPTJBQF]$/.test(cat)) return {code: "1002", why: ""};
      return {code: "", why: "salary section code to confirm: a deductor of category " + (cat || "?") + " (" + (this.CATEGORY[cat] || "not known") + ") — 1001, 1002 or 1003"};
    }
    return TDS26Q.payCodeOf(r, form, firm);
  },

  // the fields of one deductee (collectee) record after the first six, by field number
  ddOf(r, form, fy, q, firm, cat, c, problems, missing, P){
    const who = (r.party || r.employee || "?") + " (" + fmtDate(tallyDate(TDS.ymd(r.date))) + ")";
    const sc = this.sectionCode(r, form, cat, firm), code = sc.code;
    if (!code) missing.add(sc.why || "payment code to confirm: " + who);
    else if (!this.CODES[form].includes(code)) P(who + ": section code " + code + " is not in Annexure 2 of Form " + TDS.formNo(form, fy) + ".");
    const pan = String(r.pan || "").toUpperCase(), valid = Certs.validPan(pan);
    const tds = r2(num(r.tds)), paid = r2(num(r.paid));
    if (!(paid > 0)) P(who + ": the amount paid or credited must be more than 0.00.");
    // remark: A a certificate under section 395 (its number beside, 10 or 15 characters), C the higher rate with no PAN
    let remark = "", cert = "";
    if (form === "24Q"){
      const cr = Certs.forRow(Object.assign({}, r, {party: r.party || r.employee, section: "192"}));
      if (cr && TDS.sec(cr.section) === "192"){ remark = "A"; cert = String(cr.certNo || "").toUpperCase().replace(/\s/g, ""); }
      // an inoperative PAN (the owner, 17-Oct-2026): the higher rate under 397(2), PAN treated as not furnished: remark C
      else if (!valid || Certs.inoperative(pan)) remark = "C";
    }
    else { const m = TDS26Q.remark(r, form); remark = m.remark; cert = m.certFull || m.certNo || ""; }
    if (remark === "A" && !/^[A-Z0-9]{10}$|^[A-Z0-9]{15}$/.test(cert)) P(who + ": remark A needs the certificate number, 10 or 15 letters and digits (“" + cert + "”).");
    if (remark === "C" && form === "24Q" && Math.round(tds * 100) < Math.round(paid * 20)) P(who + ": remark C (no PAN) needs tax of at least 20% of the amount paid (Annexure 6).");
    const flags = (this.FLAG_CODES[form] || {})[remark];
    if (remark && code && flags && !flags.includes(code)) P(who + ": remark " + remark + " is not allowed with section code " + code + " (Annexure 6).");
    const nodef = (this.NO_DEFAULT_PAN[form] || []).includes(code);
    if (nodef && !valid) P(who + ": section code " + code + " needs the deductee's PAN.");
    const date = this.dmy(r.credit || r.date), ded = tds > 0 ? this.dmy(r.date) : "";
    const at = {8: valid ? pan : "PANNOTAVBL", 9: this.ascii(TDS26Q.fileName(r)).slice(0, 75) || "", 15: code, 18: "Y", 19: date, 20: this.money(paid),
      24: this.money(tds), 25: this.money(tds), 27: ded};
    if (!at[9]) P(who + ": the name is missing.");
    if (form === "24Q"){ at[29] = this.dmy(c.date); at[32] = remark; at[33] = cert; return at; }
    const rate = nodef ? "0.00" : tds > 0 ? (r.rate == null ? "" : r2(num(r.rate)).toFixed(4)) : "0.0000";
    if (rate === "") P(who + ": the rate of deduction is not known.");
    at[28] = rate; at[32] = remark; at[33] = cert;
    if (form === "26Q"){
      // fields 22, 23: the cash withdrawn above Rs 1 crore / 3 crore, only with section codes 1065 / 1064
      if (code === "1065" || code === "1064") P(who + ": section code " + code + " needs the amount of cash withdrawn above the limit (DD field " + (code === "1065" ? 22 : 23) + "), which FinCom does not hold.");
      return at;
    }
    if (form === "27EQ"){
      const st = this.statusOf(r);
      if (!st) P(who + ": the collectee code (Annexure 8: company, individual, HUF, AOP, co-operative society, firm …) is not known from the PAN.");
      const nr = r.nonResident ? "Y" : "N", info = TDS26Q.nrInfo(r.party);
      at[11] = nr; at[12] = st; at[13] = nr === "Y" ? (info.pe === true ? "Y" : info.pe === false ? "N" : "") : "";
      if (nr === "Y" && !at[13]) P(who + ": a non-resident collectee: whether it has a permanent establishment in India (DD field 13) is not known.");
      at[14] = this.yn(info.optOut);
      if (!at[14]) P(who + ": whether the collectee opts out of the tax regime under section 202(1) (DD field 14, mandatory) is not known.");
      return at;
    }
    // Form 144
    const info = TDS26Q.nrInfo(r.party), st = this.ascii(info.status) ? String(+this.ascii(info.status)) : this.statusOf(r);
    if (!st || !(+st >= 1 && +st <= 10)) P(who + ": the deductee's status (Annexure 8) is not known.");
    at[12] = st || "";
    at[14] = this.yn(info.optOut);
    if (!at[14]) P(who + ": whether the deductee opts out of the tax regime under section 202(1) (DD field 14, mandatory) is not known.");
    const natureList = this.NATURE_144[code], nature = this.ascii(info.nature);
    if (natureList){
      if (!nature) P(who + ": the nature of remittance (DD field 16, Annexure 9) is missing.");
      else if (!natureList.includes(nature)) P(who + ": nature of remittance " + nature + " is not one Annexure 9 allows with section code " + code + " (" + natureList.join(", ") + ").");
      at[16] = nature;
    }
    const cc = this.countryCode(info.country);
    if (!cc) P(who + ": the country to which the remittance is made (DD field 17, Annexure 10) is missing or not in the list" + (info.country ? " (“" + this.ascii(info.country) + "”)" : "") + ".");
    at[17] = cc;
    at[21] = this.yn(info.grossedUp);
    if (!at[21]) P(who + ": whether the amount is grossed up under section 393(10) (DD field 21, mandatory) is not known.");
    at[30] = info.dtaa ? "B" : "A";
    const ack = this.ascii(info.ack15ca);
    if (ack && ack.length > 26) P(who + ": the Form 15CA (Form 145) acknowledgement is longer than 26 characters.");
    at[31] = ack.slice(0, 26);
    const allowed = remark === "C" && !valid && this.NATURE_CONTACT.includes(nature), needs = allowed && num(r.rate) < 20;
    const contact = {37: this.ascii(info.address).slice(0, 150), 38: this.ascii(info.email).slice(0, 75), 39: String(info.phone || "").replace(/\D/g, "").slice(0, 15), 41: this.ascii(info.tin).slice(0, 25)};
    if (allowed) Object.assign(at, contact);
    if (needs) [[37, "address in the country of residence"], [38, "e-mail"], [39, "contact number"], [41, "tax identification number"]].forEach(([k, w]) => { if (!at[k]) P(who + ": the " + w + " (DD field " + k + ") is needed here (no PAN, remark C, rate below 20%, nature " + nature + ")."); });
    return at;
  },
  yn(v){ return v === true || /^(Y|YES)$/i.test(String(v || "")) ? "Y" : v === false || /^(N|NO)$/i.test(String(v || "")) ? "N" : ""; },
  statusOf(r){ const i = typeof TDS26Q === "object" ? TDS26Q.nrInfo(r.party) : {}; const s = this.ascii(i.status); return s ? String(+s) : this.STATUS_BY_PAN[this.panLetter(r.pan)] || ""; }
};
if (typeof globalThis === "object") globalThis.TDSF25 = TDSF25;
/* @react-lazy: end */
