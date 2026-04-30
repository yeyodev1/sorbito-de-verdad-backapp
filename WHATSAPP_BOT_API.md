# API: Crear Orden desde WhatsApp Bot

## Paso previo: obtener IDs de productos

Antes de crear órdenes, el bot debe consultar el catálogo para obtener los `_id` de cada producto:

```
GET https://sorbito-de-verdad-backapp.vercel.app/api/products
```

No requiere autenticación. Respuesta ejemplo:

```json
[
  {
    "_id": "69d29ce6c0cf68973b23bb97",
    "name": "Taza Boscán",
    "price": 25,
    "isActive": true,
    "stock": 100,
    ...
  }
]
```

El bot debe **cachear este listado** (al arrancar o periódicamente) y construir un mapa `nombre → _id` para usarlo al armar el body de cada orden. Solo los productos con `isActive: true` están disponibles.

---

## Endpoint

```
POST https://sorbito-de-verdad-backapp.vercel.app/api/orders/guest
Content-Type: application/json
```

> No requiere Authorization header. Es público.

---

## Body

```json
{
  "customerEmail": "cliente@ejemplo.com",
  "items": [
    {
      "product": "69d29ce6c0cf68973b23bb97",
      "name": "Taza Boscán",
      "image": "",
      "quantity": 2,
      "price": 25,
      "sizeName": "Estándar"
    }
  ],
  "shippingAddress": {
    "name": "Juan Pérez",
    "phone": "+593987654321",
    "street": "Av. Amazonas N24-12",
    "city": "Quito",
    "state": "Pichincha",
    "country": "Ecuador",
    "zip": "170150"
  },
  "subtotal": 50,
  "shipping": 0,
  "tax": 0,
  "total": 50,
  "paymentMethod": "transfer",
  "identificationNumber": "1717171717",
  "shippingZoneName": "Ecuador continental",
  "source": "whatsapp_bot"
}
```

### Campos obligatorios

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `customerEmail` | string | Email del cliente. Se crea cuenta automáticamente si no existe. |
| `items` | array | Lista de productos del pedido. |
| `items[].product` | string | ID de MongoDB del producto. |
| `items[].quantity` | number | Cantidad. |
| `items[].price` | number | Precio unitario (0 = usa precio del sistema). |
| `shippingAddress` | object | Dirección de envío completa. |
| `shippingAddress.name` | string | Nombre del destinatario. |
| `shippingAddress.street` | string | Calle y número. |
| `shippingAddress.city` | string | Ciudad. |
| `shippingAddress.country` | string | País. |

### Campos opcionales

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `items[].name` | string | Nombre del producto (referencial). |
| `items[].image` | string | URL de imagen (puede ir vacío). |
| `items[].sizeName` | string | Nombre del tamaño (ej. "Estándar"). |
| `shippingAddress.phone` | string | Teléfono del destinatario. |
| `shippingAddress.state` | string | Provincia/Estado. |
| `shippingAddress.zip` | string | Código postal. |
| `subtotal` | number | Referencial. El sistema recalcula desde el DB. |
| `shipping` | number | Costo de envío. Si se omite: gratis si subtotal ≥ $50, si no $5. |
| `tax` | number | Impuesto (actualmente siempre 0). |
| `total` | number | Referencial. El sistema recalcula. |
| `paymentMethod` | string | Método de pago. Default: `"transfer"`. |
| `identificationNumber` | string | Cédula o RUC del cliente. |
| `shippingZoneName` | string | Nombre de la zona de envío. |
| `source` | string | Origen del pedido. Usar siempre `"whatsapp_bot"`. |

---

## Respuesta exitosa (201)

```json
{
  "success": true,
  "data": {
    "_id": "abc123...",
    "orderNumber": "SDV-1714000000000-42",
    "user": "userId...",
    "items": [...],
    "subtotal": 50,
    "shipping": 0,
    "total": 50,
    "status": "pending",
    "paymentStatus": "pending",
    ...
  }
}
```

## Respuesta con error (400)

```json
{
  "success": false,
  "message": "customerEmail es requerido"
}
```

---

## Comportamiento automático

1. **Email nuevo** → crea cuenta con contraseña temporal → envía email de bienvenida + email de confirmación de pedido al cliente.
2. **Email ya registrado** → asocia el pedido a esa cuenta existente → envía solo email de confirmación de pedido.
3. El pedido **nunca queda asociado al admin** — siempre al cliente real.
4. El stock se descuenta automáticamente.

---

## Errores comunes

| Error | Causa |
|-------|-------|
| `"customerEmail es requerido"` | Faltó el campo `customerEmail` en el body. |
| `"Items y dirección de envío son requeridos"` | Faltó `items` o `shippingAddress`. |
| `"Producto no disponible: {id}"` | El `product` ID no existe o está inactivo. |
| `"Stock insuficiente para: {nombre}"` | No hay inventario suficiente. |
