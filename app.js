/**
 * Finanças Premium - App Logic
 * Uses vanilla JS and Dexie.js for IndexedDB
 */

// 1. Initialize Database
const db = new Dexie("FinancasDB");

// Define Schema for exactly the user requirements
db.version(1).stores({
    transacoes: '++id, descricao, valor, tipo, data, fixo, categoria',
    parcelamentos: '++id, item, valorTotal, qtdParcelas, valorParcela, mesInicio, status'
});
db.version(2).stores({
    investimentos: '++id, instituicao, tipoAtivo, saldoAtual, ultimaAtualizacao'
});

// App State & Core Logic
const app = {
    currentMonth: new Date().toISOString().slice(0, 7), // "YYYY-MM"
    categoryChartInstance: null,
    projectionChartInstance: null,

    // 1.5 UX Features (Toast)
    showToast: (title, message) => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast show glass-panel';
        toast.innerHTML = `
            <i data-lucide="check-circle" style="width: 24px; height: 24px;"></i>
            <div class="toast-content">
                <h4>${title}</h4>
                <p>${message}</p>
            </div>
        `;
        container.appendChild(toast);
        lucide.createIcons();

        // Autoclose after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // 2. Modals Control
    openModal: (modalId) => {
        document.getElementById('modal-overlay').classList.remove('hidden');
        document.querySelectorAll('.modal-content').forEach(m => m.classList.add('hidden'));
        document.getElementById(modalId).classList.remove('hidden');
        // Set specific modal date reset when opening modal
        if (modalId === 'modal-receita') {
            const dateInputReceita = document.getElementById('input-data-receita');
            if (dateInputReceita) {
                dateInputReceita.value = new Date().toISOString().split('T')[0];
            }
        }
        if (modalId === 'modal-despesa') {
            const dateInputDespesa = document.getElementById('input-data-despesa');
            if (dateInputDespesa) {
                dateInputDespesa.value = new Date().toISOString().split('T')[0];
            }
        }
    },

    closeModal: () => {
        document.getElementById('modal-overlay').classList.add('hidden');
        document.getElementById('form-transaction').reset();
        document.getElementById('form-installment').reset();
        if (document.getElementById('form-investment')) document.getElementById('form-investment').reset();
        if (document.getElementById('form-receita')) document.getElementById('form-receita').reset();
        if (document.getElementById('form-despesa')) {
            document.getElementById('form-despesa').reset();
            const wrapper = document.getElementById('wrapper-parcelas');
            if (wrapper) wrapper.classList.add('hidden'); // Ensure conditional is hidden
        }
    },

    // 3. Form Handling - Auto calculate installment logic
    setupFormListeners: () => {
        const vTotalInput = document.getElementById('inst-valor-total');
        const qParcelasInput = document.getElementById('inst-qtd-parcelas');
        const vParcelaInput = document.getElementById('inst-valor-parcela');

        const calcParcela = () => {
            const vTotal = parseFloat(vTotalInput.value || 0);
            const qParcelas = parseInt(qParcelasInput.value || 1);
            if (qParcelas > 0) {
                const result = vTotal / qParcelas;
                vParcelaInput.value = result.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            }
        };

        vTotalInput.addEventListener('input', calcParcela);
        qParcelasInput.addEventListener('input', calcParcela);

        // Preenche data de hoje no form de receita especifico
        const dateInputReceita = document.getElementById('input-data-receita');
        if (dateInputReceita) {
            const today = new Date().toISOString().split('T')[0];
            dateInputReceita.value = today;
        }

        // Preenche data de hoje no form de despesa especifico
        const dateInputDespesa = document.getElementById('input-data-despesa');
        if (dateInputDespesa) {
            const today = new Date().toISOString().split('T')[0];
            dateInputDespesa.value = today;
        }

        // Lógica de Visibilidade Condicional do Toggle "Parcelado"
        const toggleParcelado = document.getElementById('toggle-parcelado');
        const wrapperParcelas = document.getElementById('wrapper-parcelas');
        const toggleFixo = document.getElementById('toggle-fixo');

        if (toggleParcelado && wrapperParcelas) {
            toggleParcelado.addEventListener('change', (e) => {
                if (e.target.checked) {
                    wrapperParcelas.classList.remove('hidden');
                    if (toggleFixo) toggleFixo.checked = false; // Se parcelou, não é infinito/fixo
                    if (toggleFixo) toggleFixo.disabled = true;
                } else {
                    wrapperParcelas.classList.add('hidden');
                    document.getElementById('input-qtd-parcelas').value = ""; // limpa valor
                    if (toggleFixo) toggleFixo.disabled = false;
                }
            });
        }

        // Submit Listeners
        const formReceita = document.getElementById('form-receita');
        if (formReceita) {
            formReceita.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                await db.transacoes.add({
                    descricao: formData.get('descricao'),
                    valor: parseFloat(formData.get('valor')),
                    tipo: formData.get('tipo'), // Vem do input oculto 'Receita'
                    data: formData.get('data'),
                    fixo: formData.get('fixo') === 'Sim', // Vem do input oculto
                    categoria: formData.get('categoria') // Vem do input oculto
                });
                app.closeModal(); // This also clears inputs via form.reset()
                app.showToast('Sucesso', 'Receita registrada no sistema!');
                app.renderAll();
            });
        }

        const formDespesa = document.getElementById('form-despesa');
        if (formDespesa) {
            formDespesa.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const isParcelado = formData.get('isParcelado') === 'on';

                const valorTotal = parseFloat(formData.get('valor'));
                const descricao = formData.get('descricao');
                const dataRaw = formData.get('data'); // YYYY-MM-DD

                if (isParcelado) {
                    // DESTINO: TABELA PARCELAMENTOS
                    const qtd = parseInt(formData.get('qtdParcelas') || "2");
                    // Extract YYYY-MM para parcelamento
                    const mesInicio = dataRaw.substring(0, 7);

                    await db.parcelamentos.add({
                        item: descricao,
                        valorTotal: valorTotal,
                        qtdParcelas: qtd,
                        valorParcela: valorTotal / qtd,
                        mesInicio: mesInicio,
                        status: 'Ativo'
                    });
                    app.showToast('Parcelado Automaticamente', `A compra foi dividida em ${qtd}x`);
                } else {
                    // DESTINO: TABELA TRANSAÇÕES (Despesa Comum)
                    const isFixo = formData.get('isFixo') === 'on';
                    await db.transacoes.add({
                        descricao: descricao,
                        valor: valorTotal,
                        tipo: 'Despesa',
                        data: dataRaw,
                        fixo: isFixo,
                        categoria: formData.get('categoria')
                    });
                    app.showToast('Despesa Salva', 'Registrado no livro de caixa diário.');
                }

                app.closeModal();
                app.renderAll();
            });
        }

        document.getElementById('form-transaction').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            await db.transacoes.add({
                descricao: formData.get('descricao'),
                valor: parseFloat(formData.get('valor')),
                tipo: formData.get('tipo'), // 'Receita' ou 'Despesa'
                data: formData.get('data'),
                fixo: formData.get('fixo') === 'Sim',
                categoria: formData.get('categoria')
            });
            app.closeModal();
            app.showToast('Gasto Salvo', 'Sua transação foi salva na base.');
            app.renderAll();
        });

        document.getElementById('form-installment').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const total = parseFloat(formData.get('valorTotal'));
            const qtd = parseInt(formData.get('qtdParcelas'));
            await db.parcelamentos.add({
                item: formData.get('item'),
                valorTotal: total,
                qtdParcelas: qtd,
                valorParcela: total / qtd,
                mesInicio: formData.get('mesInicio'), // YYYY-MM
                status: formData.get('status')
            });
            app.closeModal();
            app.showToast('Parcelado', 'Despesa fracionada gerada.');
            app.renderAll();
        });

        document.getElementById('form-investment').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            await db.investimentos.add({
                instituicao: formData.get('instituicao'),
                tipoAtivo: formData.get('tipoAtivo'),
                saldoAtual: parseFloat(formData.get('saldoAtual')),
                taxaAnual: parseFloat(formData.get('taxaAnual') || 0), // Novo Campo Analítico
                ultimaAtualizacao: formData.get('ultimaAtualizacao')
            });
            app.closeModal();
            app.showToast('Patrimônio Atualizado', 'Sua conta de investimento foi salva.');
            app.renderAll();
        });
    },

    // 4. Data Loading and UI Rendering
    formatCurrency: (value) => {
        return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },

    formatDate: (dateStr) => {
        if (!dateStr) return '';
        if (dateStr.length === 7) { // YYYY-MM
            const [y, m] = dateStr.split('-');
            return `${m}/${y}`;
        }
        // YYYY-MM-DD
        const parts = dateStr.split('-');
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    },

    renderDashboard: (transacoes, parcelamentos, investimentos) => {
        let totalReceitas = 0;
        let totalDespesas = 0;
        let totalParcelasAtivas = 0;
        let totalPatrimonio = 0;

        const currentYYYYMM = app.currentMonth; // Usa o mês selecionado globalmente no topo

        const getMonthDiff = (start, current) => {
            const [sY, sM] = start.split('-').map(Number);
            const [cY, cM] = current.split('-').map(Number);
            return (cY - sY) * 12 + (cM - sM);
        };

        const categoryTotals = {};
        const upcomingItems = [];

        // Sum Receitas e Despesas (Somente do mês atual ou Fixas)
        transacoes.forEach(t => {
            const isCurrentMonth = t.data.startsWith(currentYYYYMM);
            if (isCurrentMonth || t.fixo) {
                if (t.tipo === 'Receita') {
                    totalReceitas += t.valor;
                } else if (t.tipo === 'Despesa') {
                    totalDespesas += t.valor;
                    // Prepara Chart: Somar por Categoria
                    const cat = t.categoria || 'Outros';
                    categoryTotals[cat] = (categoryTotals[cat] || 0) + t.valor;

                    // Prepara Lista de Próximos Vencimentos
                    upcomingItems.push({
                        title: t.descricao,
                        date: t.fixo ? `${currentYYYYMM}-${t.data.split('-')[2]}` : t.data,
                        value: t.valor,
                        isParcelado: false
                    });
                }
            }
        });

        // Sum Parcelas Ativas (Mês atual entra na janela de tempo?)
        parcelamentos.forEach(p => {
            if (p.status === 'Ativo') {
                const diff = getMonthDiff(p.mesInicio, currentYYYYMM);
                const parcelaAtual = diff + 1;
                // Exibir se: O mês atual está entre o Mês de Início e o Mês de Início + Qtd de Parcelas
                if (parcelaAtual > 0 && parcelaAtual <= p.qtdParcelas) {
                    totalParcelasAtivas += p.valorParcela;

                    categoryTotals['Parcelamentos do Cartão'] = (categoryTotals['Parcelamentos do Cartão'] || 0) + p.valorParcela;

                    upcomingItems.push({
                        title: `${p.item} (${parcelaAtual}/${p.qtdParcelas})`,
                        date: `${currentYYYYMM}-10`, // Dia ficticio p/ Cartões via de regra
                        value: p.valorParcela,
                        isParcelado: true
                    });
                }
            }
        });

        // Sum Investimentos / Patrimônio / Rendimentos CDI
        let totalRendimentoMensal = 0;
        let projecoesData = {
            saldosAtuais: []
        };

        if (investimentos) {
            investimentos.forEach(i => {
                totalPatrimonio += i.saldoAtual;

                // Calculo Matemático Engine (CDI)
                const taxaAnual = i.taxaAnual || 0;
                const taxaMensal = taxaAnual / 12; // Aproximação simples
                const rendimentoPorMes = i.saldoAtual * (taxaMensal / 100);

                totalRendimentoMensal += rendimentoPorMes;
            });
        }

        const totalSaidas = totalDespesas + totalParcelasAtivas;
        const sobra = totalReceitas - totalSaidas;

        // Atualiza UI
        document.getElementById('val-receitas').textContent = app.formatCurrency(totalReceitas);

        const valSaidasEl = document.getElementById('val-saidas');
        if (valSaidasEl) valSaidasEl.textContent = app.formatCurrency(totalSaidas);

        const valSobraEl = document.getElementById('val-sobra');
        valSobraEl.textContent = app.formatCurrency(sobra);

        // Dica de Design Matemática (Cor de Sobra)
        if (sobra > 0) {
            valSobraEl.className = "value text-positive";
        } else if (sobra < 0) {
            valSobraEl.className = "value text-negative";
        } else {
            valSobraEl.className = "value text-white";
        }

        const valPatrimonioEl = document.getElementById('val-patrimonio');
        if (valPatrimonioEl) valPatrimonioEl.textContent = app.formatCurrency(totalPatrimonio);

        const valRendimentoEl = document.getElementById('val-rendimento');
        if (valRendimentoEl) {
            valRendimentoEl.textContent = "+" + app.formatCurrency(totalRendimentoMensal);
            if (totalRendimentoMensal === 0) valRendimentoEl.classList.remove('text-success');
            else valRendimentoEl.classList.add('text-success');
        }

        // Renova o Gráfico
        app.renderCategoryChart(categoryTotals);
        // Renova Lista Simples
        app.renderUpcomingList(upcomingItems);
        // Renova Linha de Projeção Anual
        app.renderProjectionChart(investimentos, totalPatrimonio);
    },

    renderCategoryChart: (categoryTotals) => {
        const ctx = document.getElementById('categoryChart');
        if (!ctx) return;

        const labels = Object.keys(categoryTotals);
        const data = Object.values(categoryTotals);

        if (app.categoryChartInstance) {
            app.categoryChartInstance.destroy();
        }

        app.categoryChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        '#6366F1', // Indigo
                        '#F43F5E', // Rose
                        '#F59E0B', // Amber
                        '#10B981', // Emerald
                        '#8B5CF6', // Purple
                        '#3B82F6', // Blue
                        '#EC4899', // Pink
                        '#64748B'  // Slate
                    ],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#F8FAFC',
                            font: { family: "'Outfit', sans-serif", size: 11 },
                            padding: 15
                        }
                    }
                },
                cutout: '70%'
            }
        });
    },

    renderUpcomingList: (items) => {
        const listEl = document.getElementById('upcoming-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        if (items.length === 0) {
            listEl.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; opacity: 0.5;">
                    <i data-lucide="check-circle" style="width: 40px; height: 40px; margin-bottom: 0.5rem;"></i>
                    <p style="font-size: 0.9rem;">Nenhuma dívida cadastrada no mês.</p>
                </div>`;
            lucide.createIcons();
            return;
        }

        // Sort by day inside month
        items.sort((a, b) => new Date(a.date) - new Date(b.date));

        items.forEach(item => {
            const day = item.date.split('-')[2] || '--';
            const icon = item.isParcelado ? 'credit-card' : 'receipt';

            const li = document.createElement('li');
            li.className = `upcoming-item ${item.isParcelado ? 'parcelado' : ''}`;
            li.innerHTML = `
                <div class="upcoming-info">
                    <i data-lucide="${icon}" class="${item.isParcelado ? 'text-warning' : 'text-danger'}"></i>
                    <div>
                        <div class="upcoming-title">${item.title}</div>
                        <div class="upcoming-date">Vencimento: dia ${day}</div>
                    </div>
                </div>
                <div class="upcoming-value text-danger">
                    -${app.formatCurrency(item.value)}
                </div>
            `;
            listEl.appendChild(li);
        });
        lucide.createIcons();
    },

    renderProjectionChart: (investimentos, basePatrimonio) => {
        const ctx = document.getElementById('projectionChart');
        if (!ctx) return;

        if (app.projectionChartInstance) {
            app.projectionChartInstance.destroy();
        }

        if (!investimentos || investimentos.length === 0) return;

        const monthsLabels = [];
        const projData = [];
        const today = new Date();
        const startMonthIdx = today.getMonth(); // 0-11

        const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

        // Gera x meses (Motor Juros Compostos 12 meses)
        for (let i = 0; i <= 12; i++) {
            let runningSum = 0;

            investimentos.forEach(inv => {
                const taxa = inv.taxaAnual || 0;
                const taxaMensalNormalizada = (taxa / 12) / 100;
                // Juros composto real: montante = principal * (1 + taxa)^t
                const montante = inv.saldoAtual * Math.pow(1 + taxaMensalNormalizada, i);
                runningSum += montante;
            });

            projData.push(runningSum.toFixed(2));

            // Generate label e.g "Mar/25"
            const futureDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
            monthsLabels.push(`${monthNames[futureDate.getMonth()]}/${String(futureDate.getFullYear()).slice(-2)}`);
        }

        app.projectionChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: monthsLabels,
                datasets: [{
                    label: 'Patrimônio Projetado (R$)',
                    data: projData,
                    borderColor: '#4ade80',
                    backgroundColor: 'rgba(74, 222, 128, 0.1)',
                    borderWidth: 3,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#4ade80',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }, // oculto para limpar UI
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return 'Patrimônio: ' + app.formatCurrency(context.raw);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                        ticks: { color: 'rgba(255,255,255,0.6)', font: { family: "'Outfit', sans-serif" } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                        ticks: { color: 'rgba(255,255,255,0.6)', font: { family: "'Outfit', sans-serif" } }
                    }
                }
            }
        });
    },

    renderTransactionsTable: (transacoes) => {
        const tbody = document.querySelector('#table-transactions tbody');
        const emptyState = document.getElementById('empty-state-transactions');
        const table = document.getElementById('table-transactions');

        tbody.innerHTML = '';

        // Filtra para mostrar somente as transações pertinentes ao Mês Atual logado
        const filteredTransacoes = transacoes.filter(t => t.data.startsWith(app.currentMonth) || t.fixo);

        if (filteredTransacoes.length === 0) {
            emptyState.style.display = 'flex';
            table.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        table.style.display = 'table';

        filteredTransacoes.sort((a, b) => new Date(b.data) - new Date(a.data));

        filteredTransacoes.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${app.formatDate(t.data)}</td>
                <td><strong>${t.descricao}</strong></td>
                <td>${t.categoria || '-'}</td>
                <td><span class="badge ${t.tipo === 'Receita' ? 'badge-receita' : 'badge-despesa'}">${t.tipo}</span></td>
                <td><span class="badge ${t.fixo ? 'badge-sim' : 'badge-nao'}">${t.fixo ? 'Fixo' : 'Pontual'}</span></td>
                <td class="${t.tipo === 'Receita' ? 'text-success' : 'text-danger'} font-semibold">
                    ${t.tipo === 'Receita' ? '+' : '-'}${app.formatCurrency(t.valor)}
                </td>
                <td>
                    <button class="btn-icon delete" onclick="window.app.deleteTransaction(${t.id})" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    },

    renderInstallmentsTable: (parcelamentos) => {
        const tbody = document.querySelector('#table-installments tbody');
        const emptyState = document.getElementById('empty-state-installments');
        const table = document.getElementById('table-installments');

        tbody.innerHTML = '';
        if (parcelamentos.length === 0) {
            emptyState.style.display = 'flex';
            table.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        table.style.display = 'table';

        const currentYYYYMM = app.currentMonth;
        const getMonthDiff = (start, current) => {
            const [sY, sM] = start.split('-').map(Number);
            const [cY, cM] = current.split('-').map(Number);
            return (cY - sY) * 12 + (cM - sM);
        };

        parcelamentos.forEach(p => {
            const diff = getMonthDiff(p.mesInicio, currentYYYYMM);
            const parcelaAtual = diff + 1;

            let progressoHtml = "";
            if (p.status === 'Finalizado') {
                progressoHtml = `<span class="text-muted">Quitado</span>`;
            } else if (parcelaAtual <= 0) {
                progressoHtml = `<span class="text-muted">Inicia em ${app.formatDate(p.mesInicio)}</span>`;
            } else if (parcelaAtual > p.qtdParcelas) {
                progressoHtml = `<span class="text-success">Concluído</span>`;
                // Poderíamos até forçar status=Finalizado aqui no banco depois
            } else {
                progressoHtml = `<span class="text-warning">Parcela ${parcelaAtual} de ${p.qtdParcelas}</span>`;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${p.item}</strong></td>
                <td>${app.formatDate(p.mesInicio)}</td>
                <td>${progressoHtml}</td>
                <td>${app.formatCurrency(p.valorTotal)}</td>
                <td class="text-warning font-semibold">${app.formatCurrency(p.valorParcela)} / mês</td>
                <td><span class="badge ${p.status === 'Ativo' ? 'badge-ativo' : 'badge-finalizado'}">${p.status}</span></td>
                <td>
                    <button class="btn-icon" onclick="window.app.toggleStatus(${p.id}, '${p.status}')" title="${p.status === 'Ativo' ? 'Quitar Restante' : 'Reativar'}">
                        <i data-lucide="${p.status === 'Ativo' ? 'check-circle' : 'refresh-cw'}"></i>
                    </button>
                    <button class="btn-icon delete" onclick="window.app.deleteInstallment(${p.id})" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    },

    renderInvestmentsTable: (investimentos) => {
        const tbody = document.querySelector('#table-investments tbody');
        const emptyState = document.getElementById('empty-state-investments');
        const table = document.getElementById('table-investments');

        if (!tbody) return;

        tbody.innerHTML = '';
        if (investimentos.length === 0) {
            emptyState.style.display = 'flex';
            table.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        table.style.display = 'table';

        // Helper pra pegar a classe CSS da badge por tipo
        const getBadgeClass = (tipo) => {
            if (tipo === 'Conta Corrente') return 'badge-cc';
            if (tipo === 'Poupança') return 'badge-poupanca';
            if (tipo === 'CDB') return 'badge-cdb';
            if (tipo === 'Ações') return 'badge-acoes';
            return 'badge-nao';
        };

        investimentos.forEach(i => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${i.instituicao}</strong></td>
                <td><span class="badge ${getBadgeClass(i.tipoAtivo)}">${i.tipoAtivo}</span></td>
                <td class="text-accent font-semibold">${app.formatCurrency(i.saldoAtual)}</td>
                <td>${app.formatDate(i.ultimaAtualizacao)}</td>
                <td>
                    <button class="btn-icon delete" onclick="window.app.deleteInvestment(${i.id})" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    },

    // 5. Deletions and Status Toggles
    deleteTransaction: async (id) => {
        if (confirm("Tem certeza que deseja excluir esta transação?")) {
            await db.transacoes.delete(id);
            app.renderAll();
        }
    },

    deleteInstallment: async (id) => {
        if (confirm("Tem certeza que deseja excluir este parcelamento?")) {
            await db.parcelamentos.delete(id);
            app.renderAll();
        }
    },

    deleteInvestment: async (id) => {
        if (confirm("Tem certeza que deseja excluir esta conta ou investimento?")) {
            await db.investimentos.delete(id);
            app.renderAll();
        }
    },

    toggleStatus: async (id, currentStatus) => {
        const newStatus = currentStatus === 'Ativo' ? 'Finalizado' : 'Ativo';
        await db.parcelamentos.update(id, { status: newStatus });
        app.renderAll();
    },

    // 6. Main Render Loop
    renderAll: async () => {
        const transacoes = await db.transacoes.toArray();
        const parcelamentos = await db.parcelamentos.toArray();
        const investimentos = await db.investimentos ? await db.investimentos.toArray() : [];

        app.renderDashboard(transacoes, parcelamentos, investimentos);
        app.renderTransactionsTable(transacoes);
        app.renderInstallmentsTable(parcelamentos);
        if (app.renderInvestmentsTable) app.renderInvestmentsTable(investimentos);
    },

    // Initialize the application
    updateMonthDisplay: () => {
        const displayEl = document.getElementById('month-display');
        if (!displayEl) return;
        const [year, month] = app.currentMonth.split('-').map(Number);
        const date = new Date(year, month - 1, 1);
        const monthName = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        // Capitaliza a primeira letra
        displayEl.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    },

    changeMonth: (delta) => {
        const [year, month] = app.currentMonth.split('-').map(Number);
        const date = new Date(year, month - 1 + delta, 1);
        const newYear = date.getFullYear();
        const newMonth = String(date.getMonth() + 1).padStart(2, '0');
        app.currentMonth = `${newYear}-${newMonth}`;
        app.updateMonthDisplay();
        app.renderAll();
    },

    init: () => {
        // Inicializa o seletor de mês com o mês atual
        app.updateMonthDisplay();

        app.setupFormListeners();
        app.renderAll();
        // Initialize Lucide icons on page load
        lucide.createIcons();
    }
};

// Expose app to global window for onclick HTML tags
window.app = app;

// Bootstrap when DOM is ready
document.addEventListener('DOMContentLoaded', app.init);
