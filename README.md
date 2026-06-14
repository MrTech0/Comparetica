<p align="center">
  <img src="src-tauri/icons/128x128.png" width="128" height="128" alt="Comparetica Logo" />
</p>

# Comparetica

> [!NOTE]
> **Estado del proyecto**: Este proyecto se encuentra en **pleno desarrollo** y es una **versión beta**. Algunas características y funcionalidades podrían cambiar o refinarse en futuras actualizaciones.

**Comparetica** es una aplicación de escritorio B2B diseñada para consultores y asesores energéticos en España. Permite realizar estudios comparativos detallados de facturas de luz (tarifa 2.0TD) y gas (tarifa RL.1) de manera offline y local, identificando oportunidades de ahorro y gestionando las comisiones del asesor de forma profesional y discreta.

---

## 🚀 Características Principales

- **Comparador y Motor de Cálculo**: Proyecta consumos y calcula el gasto anualizado estimado del cliente (incluyendo alquiler de contador, impuestos y cargos regulados) frente a las tarifas disponibles en el mercado.
- **Precisión de hasta 6 Decimales**: Soporte completo para introducir precios de potencia (€/kW/año) y energía (€/kWh) con una precisión de hasta 6 decimales. Si no se especifican todos, los dígitos restantes se rellenan automáticamente con ceros (ej. `0.15` se calcula y muestra como `0.150000`).
- **Precios de la Energía Regulada (PVPC) en Tiempo Real**: Pantalla de inicio que consulta directamente a la API oficial de Red Eléctrica de España (REE) para mostrar el precio medio diario del PVPC, el precio del mercado pool diario (OMIE) y el desglose de precios regulados por horas en formato visual e interactivo.
- **Gestión de Tarifas (CRUD)**: Panel interno para registrar, editar y dar de baja comercializadoras y tarifas de luz o gas.
- **Modo Privado (Confidencialidad)**: Interruptor en la barra lateral que oculta visualmente (difumina) las comisiones del asesor de cara al cliente en todas las vistas de la aplicación durante presentaciones en vivo.
- **Reportes Ejecutivos en PDF**:
  - **Previsualización en Pantalla**: Permite ver el diseño del reporte en tiempo real en un visor integrado sin necesidad de guardarlo en disco.
  - **Exportación Local**: Generación nativa de un PDF estético y estructurado con el desglose de conceptos para entregar al cliente.
- **Copias de Seguridad (Backups)**:
  - **Manuales**: Posibilidad de exportar e importar la base de datos de forma segura en cualquier ruta del equipo.
  - **Automáticas**: Copia de seguridad generada automáticamente en el directorio `home` (o ruta personalizada definida por el usuario) al cerrar la aplicación.
  - **Política de Retención**: Limpieza automática de copias de seguridad antiguas basada en el número de días definidos por el usuario (por defecto, 7 días).

---

## 🛠️ Requisitos e Instalación

### Requisitos del Sistema
Para compilar y ejecutar el proyecto desde el código fuente, necesitas:
- **Node.js** (versiones LTS actualmente soportadas) y **pnpm** (versión 11 o superior).
- **Rust** (entorno de compilación cargo) y herramientas de compilación de C++ (requerido por Tauri).

### Instalación de Dependencias
Ejecuta el siguiente comando en la raíz del proyecto para descargar las librerías necesarias:
```bash
pnpm install
```

### Ejecutar en Desarrollo
Para iniciar la aplicación de escritorio en modo de desarrollo local:
```bash
pnpm tauri dev
```

---

## 📦 Compilación y Distribución

Para generar un instalador optimizado de producción para Windows (.MSI):
```bash
pnpm tauri build
```

> [!WARNING]
> ### ⚠️ Advertencia de Seguridad de Windows al Instalar
> Al instalar la aplicación en un equipo nuevo a través del archivo `.msi`, es muy probable que el sistema operativo o el filtro SmartScreen de Windows muestren una alerta de seguridad de tipo **"Editor no reconocido"** o **"Windows protegió su PC"**.
> 
> **¿Por qué ocurre esto?**
> Esto se debe a que el instalador ejecutable generado no está firmado digitalmente con un certificado de firma de código válido emitido por una autoridad certificadora oficial (como DigiCert o Sectigo). 
> 
> **Solución a futuro:**
> La firma del código es un tema planificado para resolverse en el futuro. Mientras tanto, puedes instalar y ejecutar la aplicación de forma segura haciendo clic en **"Más información"** en el cuadro de diálogo de Windows y posteriormente seleccionando el botón **"Ejecutar de todas formas"**.

---

## 📂 Estructura del Código

- `/src/index.html`: Estructura principal y plantillas de diálogos modales (Material Design 3).
- `/src/js/app.js`: Inicializador del ciclo de vida, navegación y sistema de temas.
- `/src/js/db.js`: Manejo de base de datos SQLite y consultas de almacenamiento local.
- `/src/js/calculator.js`: Motor matemático de cálculo para facturas de luz y gas.
- `/src/js/pdf.js`: Diseñador del reporte ejecutivo en PDF y previsualizador dinámico.
- `/src/js/views/`: Controladores de vistas específicas (Inicio, Historial, Comparador, Tarifas, Backups).
- `/src-tauri/`: Código nativo de integración con Windows escrito en Rust (comandos de backup, gestión de diálogos de guardado de PDF y eventos de cierre de aplicación).

---

## ⚖️ Descargo de Responsabilidad (Disclaimer)

Esta aplicación es una herramienta de simulación y estimación de ofertas energéticas para consultores profesionales. Al utilizar este software, aceptas las siguientes condiciones:

1. **Sin Garantías**: El software se proporciona "tal cual" (*as is*), sin garantías de ningún tipo, explícitas o implícitas, sobre la precisión, exhaustividad, vigencia o ausencia de errores en las fórmulas de cálculo o tarifas cargadas.
2. **Exención de Responsabilidad**: En ningún caso el autor del software (MrTech0) será responsable por reclamaciones, pérdidas de datos, perjuicios comerciales, pérdidas de clientes o cualquier otro daño directo, indirecto o accidental derivado del uso o de la imposibilidad de uso de esta herramienta.
3. **Responsabilidad del Usuario**: Es responsabilidad exclusiva del usuario (consultor o asesor) verificar la validez, vigencia y exactitud de todas las tarifas y términos de facturación directamente con las comercializadoras antes de formalizar cualquier contrato o emitir ofertas comerciales definitivas a clientes externos.

