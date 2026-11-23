# Eficiência do Chrome logado — 22/11/2026

## O que mudou

- `cv_owner_inspect {action:"overview",tab,goal}` prioriza controles pelo nome acessível, URL e contexto da seção. Devolve até cinco candidatos com seletor e link, além de `tabId` e perfil para a próxima ação; se não encontrar, sinaliza a ausência e mantém o mapa geral.
- `cv_owner_act {action:"goto",tab,url,snap:true,goal}` traz os candidatos da nova página na resposta da navegação. O agente pode agir sem uma segunda chamada de reconhecimento.
- Abas listadas e abas novas guardam o perfil dono. Com dois perfis, `tabId` sem `profile` é roteado automaticamente; uma aba desconhecida é localizada nos perfis conectados antes da ação.
- `read` tenta recuperar texto ou estrutura na própria chamada quando a destilação sinaliza conteúdo incompleto.
- As descrições visíveis no catálogo MCP orientam o agente a começar pela aba e objetivo conhecidos; `status` e `tabs` são consultas de descoberta, não etapas obrigatórias.

## Medição

Benchmark local em uma aba do painel (`test/bench-ubrowser.mjs`, duas execuções por tool, mediana; Chrome conectado). A comparação é de tamanho de resposta, não de inteligência do modelo.

| Medida | Antes | Depois |
|---|---:|---:|
| Schemas ubrowser no catálogo | ~1.023 tokens | ~984 tokens |
| Overview com objetivo “Ferramentas” | ~235 tokens, objetivo ignorado | ~191 tokens, seletor e aba retornados |
| Latência aquecida desse overview | ~57 ms | ~58 ms |

Fluxo validado: listar a aba de teste → `overview {tabId,goal:"Ferramentas"}` sem perfil → um candidato (`text=Ferramentas`) entre nove controles → `goto {snap:true,goal:"Ferramentas"}` devolveu o mesmo alvo. A primeira chamada após recarga da extensão ainda teve custo de injeção (~1,4 s); chamadas aquecidas ficaram na faixa de dezenas de ms. O objetivo usa relevância lexical e contexto, então nomes pouco descritivos ainda podem exigir `snapshot {find}` ou leitura visual.
