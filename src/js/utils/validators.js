/**
 * Módulo de validación y normalización de identificadores y suministros en España.
 * Comparetica - Utilidades de validación
 */

/**
 * Normaliza un código CUPS: elimina espacios en blanco intermedios y extremos,
 * y lo convierte a mayúsculas.
 * @param {string|any} cups Código CUPS en bruto.
 * @returns {string} CUPS normalizado en mayúsculas sin espacios.
 */
export function normalizeCups(cups) {
  if (cups === null || cups === undefined) return '';
  return String(cups).replace(/\s+/g, '').toUpperCase();
}

/**
 * Valida si un código CUPS cumple la normativa oficial española:
 * - Prefijo de país 'ES'.
 * - 16 dígitos numéricos (distribuidora + número de suministro).
 * - 2 letras de control (A-Z).
 * - Opcionalmente 2 caracteres alfanuméricos de puntos de medida/frontera (0-9, A-Z).
 * Longitud total permitida: exactamente 20 o 22 caracteres.
 * 
 * @param {string|any} cups Código CUPS a validar.
 * @returns {boolean} True si el CUPS es válido según formato oficial español.
 */
export function isValidSpanishCups(cups) {
  if (typeof cups !== 'string') return false;
  const cleanCups = cups.trim().toUpperCase();
  if (cleanCups.length !== 20 && cleanCups.length !== 22) return false;
  
  const cupsRegex = /^ES\d{16}[A-Z]{2}([0-9A-Z]{2})?$/;
  return cupsRegex.test(cleanCups);
}

/**
 * Valida un DNI español con su dígito de control correspondiente.
 * @param {string} dni Cadena con el DNI.
 * @returns {boolean}
 */
export function validateDNI(dni) {
  if (typeof dni !== 'string') return false;
  const match = dni.match(/^(\d{8})([A-Z])$/);
  if (!match) return false;
  const num = parseInt(match[1], 10);
  const letter = match[2];
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  return letters[num % 23] === letter;
}

/**
 * Valida un NIE de residente extranjero en España.
 * @param {string} nie Cadena con el NIE.
 * @returns {boolean}
 */
export function validateNIE(nie) {
  if (typeof nie !== 'string') return false;
  const cleanNie = nie.replace(/^X/, '0').replace(/^Y/, '1').replace(/^Z/, '2');
  return validateDNI(cleanNie);
}

/**
 * Valida un CIF de persona jurídica u organización en España.
 * @param {string} cif Cadena con el CIF.
 * @returns {boolean}
 */
export function validateCIF(cif) {
  if (typeof cif !== 'string') return false;
  const match = cif.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (!match) return false;
  
  const letter = match[1];
  const digits = match[2];
  const control = match[3];
  
  let oddSum = 0;
  let evenSum = 0;
  
  for (let i = 0; i < 7; i++) {
    const d = parseInt(digits.charAt(i), 10);
    if (i % 2 === 0) {
      let temp = d * 2;
      if (temp > 9) temp -= 9;
      oddSum += temp;
    } else {
      evenSum += d;
    }
  }
  
  const totalSum = oddSum + evenSum;
  const controlDigit = (10 - (totalSum % 10)) % 10;
  const letters = 'JABCDEFGHI';
  const controlLetter = letters.charAt(controlDigit);
  
  if ('KPQRSNW'.includes(letter)) {
    return control === controlLetter;
  } else if ('ABEHMX'.includes(letter)) {
    return parseInt(control, 10) === controlDigit;
  } else {
    return parseInt(control, 10) === controlDigit || control === controlLetter;
  }
}

/**
 * Valida un documento de identidad español (DNI, NIE o CIF).
 * @param {string|any} id Identificador fiscal.
 * @returns {boolean}
 */
export function isValidSpanishId(id) {
  if (typeof id !== 'string' || !id) return false;
  const cleanId = id.toUpperCase().replace(/[\s-]/g, '');
  if (/^[XYZ]/.test(cleanId)) return validateNIE(cleanId);
  if (/^[ABCDEFGHJNPQRSUVW]/.test(cleanId)) return validateCIF(cleanId);
  if (/^\d/.test(cleanId)) return validateDNI(cleanId);
  return false;
}
