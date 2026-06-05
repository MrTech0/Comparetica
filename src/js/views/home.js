/* src/js/views/home.js */

export async function initHomeView() {
  setupRefreshButton();
  await loadMarketData();
}

function setupRefreshButton() {
  const btn = document.getElementById('refresh-market-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      await loadMarketData();
    });
  }
}

async function loadMarketData() {
  const loader = document.getElementById('market-loader');
  const errorDiv = document.getElementById('market-error');
  const grid = document.getElementById('market-hourly-grid');
  const avgKwhEl = document.getElementById('market-avg-kwh');
  const avgMwhEl = document.getElementById('market-avg-mwh');
  const dateLabel = document.getElementById('home-date-label');

  // Configurar UI de carga
  loader.style.display = 'block';
  errorDiv.style.display = 'none';
  grid.style.display = 'none';

  // Obtener fecha local de hoy en España en formato YYYY-MM-DD
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  // Actualizar etiqueta de fecha
  const friendlyDate = today.toLocaleDateString('es-ES', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  if (dateLabel) dateLabel.innerText = friendlyDate;

  // Endpoint oficial sin token de Red Eléctrica de España (REData)
  const url = `https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=${dateStr}T00:00&end_date=${dateStr}T23:59&time_trunc=hour`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Network response was not OK");
    const json = await response.json();

    // 1. Localizar los indicadores en la respuesta
    const pvpcIndicator = json.included.find(i => i.id === '1001' || i.type === 'PVPC');
    const spotIndicator = json.included.find(i => i.id === '600' || i.type.includes('spot'));

    if (!pvpcIndicator || !pvpcIndicator.attributes.values || pvpcIndicator.attributes.values.length === 0) {
      throw new Error("PVPC data not found in REE response");
    }

    const pvpcValues = pvpcIndicator.attributes.values;
    const spotValues = spotIndicator ? spotIndicator.attributes.values : [];

    // 2. Calcular los precios medios
    // PVPC viene en €/MWh. Dividimos entre 1000 para pasarlo a €/kWh
    const avgPvpcMwh = pvpcValues.reduce((sum, item) => sum + item.value, 0) / pvpcValues.length;
    const avgPvpcKwh = avgPvpcMwh / 1000;

    avgKwhEl.innerText = `${avgPvpcKwh.toLocaleString('es-ES', { minimumFractionDigits: 5, maximumFractionDigits: 5 })} €/kWh`;
    
    if (spotValues && spotValues.length > 0) {
      const avgSpotMwh = spotValues.reduce((sum, item) => sum + item.value, 0) / spotValues.length;
      avgMwhEl.innerText = `${avgSpotMwh.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/MWh`;
    } else {
      // Estimación fallback si el spot viene vacío
      avgMwhEl.innerText = `${(avgPvpcMwh * 0.85).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/MWh`;
    }

    // 3. Renderizar rejilla horaria de precios
    renderHourlyGrid(pvpcValues);

    // Ajustar visibilidad
    loader.style.display = 'none';
    grid.style.display = 'grid';

  } catch (error) {
    console.error("Error al cargar datos del mercado:", error);
    loader.style.display = 'none';
    errorDiv.style.display = 'block';
  }
}

function renderHourlyGrid(values) {
  const grid = document.getElementById('market-hourly-grid');
  grid.innerHTML = '';

  // Calcular distribución de precios para asignar tramos (Valle / Llano / Punta) dinámicamente hoy
  const prices = values.map(v => v.value / 1000);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;
  
  // Límites tramos de precio hoy
  const tValley = minPrice + priceRange / 3;
  const tFlat = minPrice + (2 * priceRange) / 3;

  values.forEach(item => {
    const priceKwh = item.value / 1000;
    const date = new Date(item.datetime);
    const hour = String(date.getHours()).padStart(2, '0');
    const nextHour = String((date.getHours() + 1) % 24).padStart(2, '0');
    const hourLabel = `${hour}:00 - ${nextHour}:00`;

    // Determinar tramo dinámico
    let tramoClass = '';
    let tramoText = '';
    let badgeStyle = '';

    if (priceKwh <= tValley) {
      tramoText = 'Valle';
      badgeStyle = 'background-color: var(--color-tertiary-container); color: var(--color-on-tertiary-container);';
    } else if (priceKwh <= tFlat) {
      tramoText = 'Llano';
      badgeStyle = 'background-color: hsl(35, 90%, 90%); color: hsl(35, 90%, 25%);';
    } else {
      tramoText = 'Punta';
      badgeStyle = 'background-color: var(--color-error-container); color: var(--color-on-error-container);';
    }

    const card = document.createElement('div');
    card.className = 'hour-card';
    
    // Si la hora es la actual de la máquina, la remarcamos con un borde especial
    const currentHour = new Date().getHours();
    if (date.getHours() === currentHour) {
      card.style.borderColor = 'var(--color-primary)';
      card.style.borderWidth = '2px';
      card.style.boxShadow = 'var(--shadow-2)';
    }

    card.innerHTML = `
      <div class="hour-card-time">${hourLabel}</div>
      <div class="hour-card-price">${priceKwh.toFixed(5)} €</div>
      <span class="hour-card-badge" style="${badgeStyle}">${tramoText}</span>
    `;

    grid.appendChild(card);
  });
}
