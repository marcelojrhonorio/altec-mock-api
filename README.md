# Altec Totem Mock API

Mock API para o fluxo de totem, com foco em catalogo/pedido aderente ao OpenDelivery.

## Stack
- Bun
- Express
- WebSocket (ws)

## Como rodar
```bash
bun install
bun start
```

Base URL local: `http://127.0.0.1:10099/v1`

Auth padrao:
```http
Authorization: ApiKey ksk_mock_altec_001
```

## Escopo implementado (OpenDelivery + compatibilidade)

### 1) Tela inicial: categorias e produtos por categoria
Endpoint principal:
- `GET /v1/merchant`

Como usar na UI:
1. Ler `categories[]` para renderizar as categorias.
2. Ao clicar na categoria, usar `category.itemOfferId[]` para montar a lista de produtos.
3. Resolver cada `itemOffer` em `itemOffers[]` e depois `items[]` para nome/descricao/imagem.

### 2) Edicao/customizacao de item
No padrao OD, a customizacao e modelada por:
- `itemOffers[].optionGroupsId[]`
- `optionGroups[].options[]`

Casos implementados no mock:
- remover ingrediente (ex.: Sem cebola) via grupo `Remocoes`
- adicionar ingrediente (ex.: Queijo Extra, Bacon Extra) via grupo `Complementos`
- todo produto possui fallback automatico de customizacao em todos os endpoints de catalogo
- cada produto possui no minimo:
	- 4 opcoes de remocao (`WITHOUT`) com preco zero
	- 15 opcoes de adicional (`EXTRA`) com preco positivo
- customizacao com variacao semantica por categoria (ex.: bebidas priorizam sem gelo/sem acucar)
- cada option no `GET /v1/merchant` retorna preco no padrao OpenDelivery (`price.value`, `price.originalValue`, `price.currency`)

### 3) Atualizacao de total do pedido
Decisao de arquitetura:
- total em tempo real durante montagem: calculado no frontend
- fonte de preco/opcoes: `GET /v1/merchant`
- mock atual: cada item do merchant expoe os grupos `Remocoes` e `Complementos`
- total final do pedido: retornado por `GET /v1/orders/{orderId}`

Obs.: nao foi criado endpoint custom de carrinho para manter aderencia ao OpenDelivery.

### 4) Resumo do pedido
Endpoint:
- `GET /v1/orders/{orderId}`

Retorna:
- itens
- opcoes/customizacoes
- total
- pagamentos

### 5) Atualizacao de detalhes do pedido (OD)
Endpoint:
- `PATCH /v1/orders/{orderId}/details`

Campos permitidos neste mock:
- `preparationStartDateTime`
- `extraInfo`

### 6) Recebimento de evento de pedido
Endpoint:
- `POST /v1/orderUpdate`

Validacoes:
- `eventType` deve ser `CREATED`
- `metadata.order` obrigatorio

## Endpoints da API

### Configuracao
- `GET /v1/tenants/{tenantId}/establishments/{establishmentId}/kiosks/{kioskId}/config`

### Bootstrap
- `POST /v1/kiosks/bootstrap`

### Catalogo/Pedido (atual)
- `GET /v1/merchant`
- `GET /v1/products/{id}` (compatibilidade)
- `GET /v1/catalog` (compatibilidade para lista de categorias/produtos)
- `POST /v1/orderUpdate`
- `GET /v1/orders/{orderId}`
- `PATCH /v1/orders/{orderId}/details`

### WebSocket utilitario
- `POST /v1/ws/emit`
- `WS /v1/ws?api_key=...`

## Arquivos de dados
- `data/catalog.json`: fonte principal de categorias/produtos/compositions/combinations
- `data/orders_static.json`: pedido estatico de referencia
- `data/orders_dynamic.json`: persistencia de pedidos recebidos

## Testes
```bash
# iniciar servidor em outro terminal
bun start

# executar suite
bun run test
```
Cobertura atual valida:
- config/bootstrap/catalog/merchant
- consistencia de customizacao entre merchant/catalog/products
- regra de remocoes (WITHOUT) e complementos (EXTRA)
- orderUpdate
- orders get
- websocket

## OpenAPI e Postman
- Contrato: `openapi.yaml`
- Colecao Postman: `Altec_Totem_Mock_API.postman_collection.json`

## TESTE-APPEND
