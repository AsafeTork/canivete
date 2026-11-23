# UX da extensão — 21/11/2026

## Público e tarefas

Hipótese baseada nos fluxos e ferramentas do próprio Canivete; ainda não é pesquisa com usuários. O público principal usa agentes em CLI ou apps MCP com um Chrome já autenticado. Quer saber rapidamente se a ponte está conectada, impedir ações quando necessário e delimitar o que o agente pode fazer. Quem desenvolve ou depura automações também precisa ver fila, erros e itens para revisar. Perfis pessoais e de trabalho pedem alcance claro por site e por perfil.

## Referências verificadas

- [Chrome Extensions Best Practices](https://developer.chrome.com/docs/webstore/best-practices): interface simples, intuitiva e respeitosa com a privacidade; superfícies persistentes devem ajudar sem distrair.
- [Chrome: Add a popup](https://developer.chrome.com/docs/extensions/develop/ui/add-popup): o popup fecha quando o foco sai; por isso concentra decisões rápidas e salva cada alteração imediatamente.
- [Chrome: Options page](https://developer.chrome.com/docs/extensions/develop/ui/options-page): personalizar funções relevantes é uma expectativa da plataforma.
- [NN/g: Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/): mostrar o estado atual ajuda o usuário a agir e confiar.
- [NN/g: User Control and Freedom](https://www.nngroup.com/articles/user-control-and-freedom/): saída clara e reversão são essenciais; pausar e reativar ficam no topo.
- [NN/g: Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/): informação secundária disputa atenção com a tarefa principal; diagnóstico avançado fica recolhido.

## Decisões aplicadas

Estilo: **Ácido-Noir** já usado no projeto, com fundo escuro, Space Grotesk, Geist Mono somente em dados e verde ácido reservado à ação principal. No popup, a ordem é: conexão real, pausa, capacidade, sites, captura, ação. O modo inicial permanece **Operar em todos os sites**, preservando o comportamento atual. Modo Ler aceita consultas; Navegar aceita consultas e navegação; Operar aceita interação. Sites escolhidos filtra as abas apresentadas ao agente e bloqueia comandos dirigidos a outros sites. O perfil pausado só é reativado pelo popup, pois não consulta a ponte enquanto está pausado. O painel completo abre com perfis, fila e pendências; telemetria detalhada continua abaixo.

## Limites e próximo passo de pesquisa

O filtro de sites atua nos comandos do Canivete; a permissão de host da extensão continua configurável no Chrome. Navegações iniciadas dentro de uma página ou por JavaScript podem mudar de site; o próximo comando será verificado novamente. Validar o texto dos três modos e a descoberta do controle de sites com usuários reais é o próximo passo de pesquisa.
