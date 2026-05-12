/**
 * IFinance ViPRo - App Logic
 * Uses vanilla JS and Dexie.js for IndexedDB
 *
 * Correções aplicadas:
 * 1. Bug: transações fixas não duplicam em múltiplos meses
 * 2. Bug: closeModal() seguro com checagem de existência do form
 * 3. UX: confirm() substituído por modal de confirmação estilizado
 * 4. UX: Toast de erro (vermelho) nos submits com try/catch
 * 5. UX: Botão de edição nas tabelas de transações e investimentos
 * 6. UX: Campo de busca em tempo real na tabela de transações
 * 7. Código: Validação de valor > 0 e qtdParcelas obrigatório
 * 8. Código: Schema do Dexie consolidado em versão única
 * 9. Feature: Exportar/Importar dados como JSON
 */

// ─── 1. Database ─────────────────────────────────────────────────────────────
// Schema consolidado em versão única (fix #8)
const db = new Dexie("FinancasDB");
db.version(3).stores({
    transacoes:    '++id, descricao, valor, tipo, data, fixo, categoria',
    parcelamentos: '++id, item, valorTotal, qtdParcelas, valorParcela, mesInicio, status',
    investimentos: '++id, instituicao, tipoAtivo, saldoAtual, taxaAnual, ultimaAtualizacao'
}).upgrade(tx => {
    // Garante que investimentos antigos sem taxaAnual tenham o campo como 0
    return tx.table('investimentos').toCollection().modify(inv => {
        if (inv.taxaAnual === undefined) inv.taxaAnual = 0;
    });
});

// ─── 2. State ────────────────────────────────────────────────────────────────
const app = {
    currentMonth: new Date().toISOString().slice(0, 7),
    categoryChartInstance: null,
    projectionChartInstance: null,
    searchQuery: '',
    // Referência para registro sendo editado
    editingTransactionId: null,
    editingInvestmentId: null,

    // ─── Toast ───────────────────────────────────────────────────────────────
    // Fix #4: suporte a tipo 'error'
    showToast: (title, message, type = 'success') => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icons = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle' };
        const colors = { success: 'var(--success)', error: 'var(--danger)', warning: 'var(--warning)' };

        const toast = document.createElement('div');
        toast.className = 'toast show glass-panel';
        toast.style.borderLeftColor = colors[type] || colors.success;
        toast.innerHTML = `
            <i data-lucide="${icons[type] || icons.success}" style="width:24px;height:24px;color:${colors[type]};flex-shrink:0;"></i>
            <div class="toast-content">
                <h4>${title}</h4>
                <p>${message}</p>
            </div>
        `;
        container.appendChild(toast);
        lucide.createIcons();
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    },

    // ─── Modal de Confirmação (Fix #3) ───────────────────────────────────────
    showConfirm: (message, onConfirm) => {
        const existing = document.getElementById('confirm-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'confirm-modal';
        modal.style.cssText = `
            position:fixed;inset:0;z-index:600;
            background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);
            display:flex;align-items:center;justify-content:center;padding:1rem;
        `;
        modal.innerHTML = `
            <div class="glass-panel" style="
                background:var(--bg-surface);max-width:380px;width:100%;
                padding:2rem;border-radius:20px;
                box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);
                animation: slideUp 0.2s ease;
            ">
                <div style="display:flex;align-items:flex-start;gap:1rem;margin-bottom:1.5rem;">
                    <div style="background:var(--danger-bg);padding:0.6rem;border-radius:12px;flex-shrink:0;">
                        <i data-lucide="trash-2" style="width:22px;height:22px;color:var(--danger);"></i>
                    </div>
                    <div>
                        <h3 style="font-size:1.05rem;font-weight:600;margin-bottom:0.4rem;">Confirmar exclusão</h3>
                        <p style="font-size:0.9rem;color:var(--text-muted);line-height:1.5;">${message}</p>
                    </div>
                </div>
                <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                    <button id="confirm-cancel" class="btn btn-outline" style="padding:0.6rem 1.2rem;">Cancelar</button>
                    <button id="confirm-ok" style="
                        background:var(--danger);color:white;border:none;
                        padding:0.6rem 1.2rem;border-radius:12px;font-weight:600;
                        font-family:var(--font-family);cursor:pointer;font-size:0.9rem;
                    ">Excluir</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        lucide.createIcons();

        document.getElementById('confirm-cancel').onclick = () => modal.remove();
        document.getElementById('confirm-ok').onclick = () => { modal.remove(); onConfirm(); };
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    },

    // ─── Modais principais ───────────────────────────────────────────────────
    openModal: (modalId) => {
        document.getElementById('modal-overlay').classList.remove('hidden');
        document.querySelectorAll('.modal-content').forEach(m => m.classList.add('hidden'));
        const target = document.getElementById(modalId);
        if (target) target.classList.remove('hidden');

        const today = new Date().toISOString().split('T')[0];
        if (modalId === 'modal-receita') {
            const el = document.getElementById('input-data-receita');
            if (el && !app.editingTransactionId) el.value = today;
        }
        if (modalId === 'modal-despesa') {
            const el = document.getElementById('input-data-despesa');
            if (el && !app.editingTransactionId) el.value = today;
        }
        if (modalId === 'modal-investment') {
            const el = document.querySelector('#form-investment [name="ultimaAtualizacao"]');
            if (el && !app.editingInvestmentId) el.value = today;
        }
    },

    // Fix #2: reset seguro verificando existência do elemento
    closeModal: () => {
        document.getElementById('modal-overlay').classList.add('hidden');
        app.editingTransactionId = null;
        app.editingInvestmentId = null;

        // Atualiza label do botão de submit do modal receita
        const submitReceita = document.querySelector('#form-receita button[type="submit"]');
        if (submitReceita) submitReceita.textContent = 'Registrar Receita';
        const submitInvest = document.querySelector('#form-investment button[type="submit"]');
        if (submitInvest) submitInvest.textContent = 'Salvar Conta';

        const forms = ['form-transaction', 'form-installment', 'form-investment', 'form-receita', 'form-despesa'];
        forms.forEach(id => {
            const f = document.getElementById(id);
            if (f) f.reset();
        });

        const wrapper = document.getElementById('wrapper-parcelas');
        if (wrapper) wrapper.classList.add('hidden');
        const toggleFixo = document.getElementById('toggle-fixo');
        if (toggleFixo) toggleFixo.disabled = false;
    },

    // ─── Listeners de Formulário ─────────────────────────────────────────────
    setupFormListeners: () => {
        // Auto-cálculo parcela
        const vTotal = document.getElementById('inst-valor-total');
        const qParcelas = document.getElementById('inst-qtd-parcelas');
        const vParcela = document.getElementById('inst-valor-parcela');
        const calcParcela = () => {
            const v = parseFloat(vTotal?.value || 0);
            const q = parseInt(qParcelas?.value || 1);
            if (q > 0 && vParcela) {
                vParcela.value = (v / q).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            }
        };
        vTotal?.addEventListener('input', calcParcela);
        qParcelas?.addEventListener('input', calcParcela);

        // Toggle parcelado
        const toggleParcelado = document.getElementById('toggle-parcelado');
        const wrapperParcelas = document.getElementById('wrapper-parcelas');
        const toggleFixo = document.getElementById('toggle-fixo');
        toggleParcelado?.addEventListener('change', (e) => {
            if (e.target.checked) {
                wrapperParcelas?.classList.remove('hidden');
                if (toggleFixo) { toggleFixo.checked = false; toggleFixo.disabled = true; }
            } else {
                wrapperParcelas?.classList.add('hidden');
                const qtd = document.getElementById('input-qtd-parcelas');
                if (qtd) qtd.value = '';
                if (toggleFixo) toggleFixo.disabled = false;
            }
        });

        // ── Receita ──────────────────────────────────────────────────────────
        document.getElementById('form-receita')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const valor = parseFloat(formData.get('valor'));
            // Fix #7: validação de valor
            if (!valor || valor <= 0) {
                app.showToast('Valor inválido', 'Informe um valor maior que zero.', 'error');
                return;
            }
            try {
                const dados = {
                    descricao: formData.get('descricao'),
                    valor,
                    tipo: 'Receita',
                    data: formData.get('data'),
                    fixo: false,
                    categoria: 'Salário/Rendimentos'
                };
                if (app.editingTransactionId) {
                    await db.transacoes.update(app.editingTransactionId, dados);
                    app.showToast('Receita atualizada', 'Registro editado com sucesso!');
                } else {
                    await db.transacoes.add(dados);
                    app.showToast('Receita registrada', 'Entrada salva no livro caixa.');
                }
                app.closeModal();
                app.renderAll();
            } catch (err) {
                app.showToast('Erro ao salvar', 'Tente novamente. (' + err.message + ')', 'error');
            }
        });

        // ── Despesa ──────────────────────────────────────────────────────────
        document.getElementById('form-despesa')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const isParcelado = formData.get('isParcelado') === 'on';
            const valor = parseFloat(formData.get('valor'));

            // Fix #7: validação
            if (!valor || valor <= 0) {
                app.showToast('Valor inválido', 'Informe um valor maior que zero.', 'error');
                return;
            }
            if (isParcelado) {
                const qtd = parseInt(formData.get('qtdParcelas') || '0');
                if (!qtd || qtd < 2) {
                    app.showToast('Parcelas inválidas', 'Informe pelo menos 2 parcelas.', 'error');
                    return;
                }
            }

            try {
                const descricao = formData.get('descricao');
                const dataRaw = formData.get('data');

                if (isParcelado) {
                    const qtd = parseInt(formData.get('qtdParcelas'));
                    await db.parcelamentos.add({
                        item: descricao,
                        valorTotal: valor,
                        qtdParcelas: qtd,
                        valorParcela: valor / qtd,
                        mesInicio: dataRaw.substring(0, 7),
                        status: 'Ativo'
                    });
                    app.showToast('Parcelado', `Compra dividida em ${qtd}x.`);
                } else {
                    const isFixo = formData.get('isFixo') === 'on';
                    await db.transacoes.add({
                        descricao,
                        valor,
                        tipo: 'Despesa',
                        data: dataRaw,
                        fixo: isFixo,
                        categoria: formData.get('categoria')
                    });
                    app.showToast('Despesa salva', 'Registrado no livro caixa.');
                }
                app.closeModal();
                app.renderAll();
            } catch (err) {
                app.showToast('Erro ao salvar', 'Tente novamente. (' + err.message + ')', 'error');
            }
        });

        // ── Transação manual ─────────────────────────────────────────────────
        document.getElementById('form-transaction')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const valor = parseFloat(formData.get('valor'));
            if (!valor || valor <= 0) {
                app.showToast('Valor inválido', 'Informe um valor maior que zero.', 'error');
                return;
            }
            try {
                await db.transacoes.add({
                    descricao: formData.get('descricao'),
                    valor,
                    tipo: formData.get('tipo'),
                    data: formData.get('data'),
                    fixo: formData.get('fixo') === 'Sim',
                    categoria: formData.get('categoria')
                });
                app.closeModal();
                app.showToast('Transação salva', 'Registro incluído com sucesso.');
                app.renderAll();
            } catch (err) {
                app.showToast('Erro ao salvar', err.message, 'error');
            }
        });

        // ── Parcelamento manual ──────────────────────────────────────────────
        document.getElementById('form-installment')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const total = parseFloat(formData.get('valorTotal'));
            const qtd = parseInt(formData.get('qtdParcelas'));
            if (!total || total <= 0) {
                app.showToast('Valor inválido', 'Informe um valor maior que zero.', 'error');
                return;
            }
            if (!qtd || qtd < 1) {
                app.showToast('Parcelas inválidas', 'Informe ao menos 1 parcela.', 'error');
                return;
            }
            try {
                await db.parcelamentos.add({
                    item: formData.get('item'),
                    valorTotal: total,
                    qtdParcelas: qtd,
                    valorParcela: total / qtd,
                    mesInicio: formData.get('mesInicio'),
                    status: formData.get('status')
                });
                app.closeModal();
                app.showToast('Parcelamento salvo', 'Despesa fracionada registrada.');
                app.renderAll();
            } catch (err) {
                app.showToast('Erro ao salvar', err.message, 'error');
            }
        });

        // ── Investimento / Conta ─────────────────────────────────────────────
        document.getElementById('form-investment')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const saldo = parseFloat(formData.get('saldoAtual'));
            if (isNaN(saldo) || saldo < 0) {
                app.showToast('Saldo inválido', 'Informe um saldo válido (0 ou maior).', 'error');
                return;
            }
            try {
                const dados = {
                    instituicao: formData.get('instituicao'),
                    tipoAtivo: formData.get('tipoAtivo'),
                    saldoAtual: saldo,
                    taxaAnual: parseFloat(formData.get('taxaAnual') || 0),
                    ultimaAtualizacao: formData.get('ultimaAtualizacao')
                };
                if (app.editingInvestmentId) {
                    await db.investimentos.update(app.editingInvestmentId, dados);
                    app.showToast('Conta atualizada', 'Registro editado com sucesso!');
                } else {
                    await db.investimentos.add(dados);
                    app.showToast('Patrimônio atualizado', 'Conta ou investimento salvo.');
                }
                app.closeModal();
                app.renderAll();
            } catch (err) {
                app.showToast('Erro ao salvar', err.message, 'error');
            }
        });

        // ── Busca em tempo real (Fix #6) ─────────────────────────────────────
        document.getElementById('search-transactions')?.addEventListener('input', (e) => {
            app.searchQuery = e.target.value.toLowerCase().trim();
            app.renderAll();
        });
    },

    // ─── Formatação ──────────────────────────────────────────────────────────
    formatCurrency: (value) =>
        value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),

    formatDate: (dateStr) => {
        if (!dateStr) return '';
        if (dateStr.length === 7) {
            const [y, m] = dateStr.split('-');
            return `${m}/${y}`;
        }
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    },

    // ─── Dashboard ───────────────────────────────────────────────────────────
    // Fix #1: transações fixas só contam uma vez, no mês atual
    renderDashboard: (transacoes, parcelamentos, investimentos) => {
        let totalReceitas = 0;
        let totalDespesas = 0;
        let totalParcelasAtivas = 0;
        let totalPatrimonio = 0;
        const currentYYYYMM = app.currentMonth;

        const getMonthDiff = (start, current) => {
            const [sY, sM] = start.split('-').map(Number);
            const [cY, cM] = current.split('-').map(Number);
            return (cY - sY) * 12 + (cM - sM);
        };

        const categoryTotals = {};
        const upcomingItems = [];

        transacoes.forEach(t => {
            const isCurrentMonth = t.data.startsWith(currentYYYYMM);
            // Fix #1: transação fixa só entra se o mês atual é igual ou posterior à data original
            // e nunca duplica — usamos apenas isCurrentMonth para exibição; fixo serve para
            // indicar na tabela/UI, mas não multiplica o valor entre meses diferentes.
            if (!isCurrentMonth && !t.fixo) return;
            if (t.fixo && !isCurrentMonth) {
                // Gasto fixo: exibir no mês atual com o dia original
                // Só inclui se a data original for anterior ou igual ao mês atual
                const [tY, tM] = t.data.split('-').map(Number);
                const [cY, cM] = currentYYYYMM.split('-').map(Number);
                const isFutureDate = (tY > cY) || (tY === cY && tM > cM);
                if (isFutureDate) return; // Ainda não chegou a data de início
            }

            if (t.tipo === 'Receita') {
                totalReceitas += t.valor;
            } else if (t.tipo === 'Despesa') {
                totalDespesas += t.valor;
                const cat = t.categoria || 'Outros';
                categoryTotals[cat] = (categoryTotals[cat] || 0) + t.valor;
                const dia = t.fixo ? `${currentYYYYMM}-${t.data.split('-')[2]}` : t.data;
                upcomingItems.push({ title: t.descricao, date: dia, value: t.valor, isParcelado: false });
            }
        });

        parcelamentos.forEach(p => {
            if (p.status !== 'Ativo') return;
            const diff = getMonthDiff(p.mesInicio, currentYYYYMM);
            const parcelaAtual = diff + 1;
            if (parcelaAtual > 0 && parcelaAtual <= p.qtdParcelas) {
                totalParcelasAtivas += p.valorParcela;
                categoryTotals['Parcelamentos do Cartão'] = (categoryTotals['Parcelamentos do Cartão'] || 0) + p.valorParcela;
                upcomingItems.push({
                    title: `${p.item} (${parcelaAtual}/${p.qtdParcelas})`,
                    date: `${currentYYYYMM}-10`,
                    value: p.valorParcela,
                    isParcelado: true
                });
            }
        });

        let totalRendimentoMensal = 0;
        if (investimentos) {
            investimentos.forEach(i => {
                totalPatrimonio += i.saldoAtual;
                const taxaAnual = i.taxaAnual || 0;
                totalRendimentoMensal += i.saldoAtual * ((taxaAnual / 12) / 100);
            });
        }

        const totalSaidas = totalDespesas + totalParcelasAtivas;
        const sobra = totalReceitas - totalSaidas;

        document.getElementById('val-receitas').textContent = app.formatCurrency(totalReceitas);
        const valSaidasEl = document.getElementById('val-saidas');
        if (valSaidasEl) valSaidasEl.textContent = app.formatCurrency(totalSaidas);

        const valSobraEl = document.getElementById('val-sobra');
        valSobraEl.textContent = app.formatCurrency(sobra);
        valSobraEl.className = sobra > 0 ? 'value text-positive' : sobra < 0 ? 'value text-negative' : 'value text-white';

        const valPatrimonioEl = document.getElementById('val-patrimonio');
        if (valPatrimonioEl) valPatrimonioEl.textContent = app.formatCurrency(totalPatrimonio);

        const valRendimentoEl = document.getElementById('val-rendimento');
        if (valRendimentoEl) {
            valRendimentoEl.textContent = '+' + app.formatCurrency(totalRendimentoMensal);
            valRendimentoEl.classList.toggle('text-success', totalRendimentoMensal > 0);
        }

        app.renderCategoryChart(categoryTotals);
        app.renderUpcomingList(upcomingItems);
        app.renderProjectionChart(investimentos, totalPatrimonio);
    },

    renderCategoryChart: (categoryTotals) => {
        const ctx = document.getElementById('categoryChart');
        if (!ctx) return;
        if (app.categoryChartInstance) app.categoryChartInstance.destroy();

        const labels = Object.keys(categoryTotals);
        const data = Object.values(categoryTotals);

        app.categoryChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: ['#6366F1','#F43F5E','#F59E0B','#10B981','#8B5CF6','#3B82F6','#EC4899','#64748B'],
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
                        labels: { color: '#F8FAFC', font: { family: "'Outfit', sans-serif", size: 11 }, padding: 15 }
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
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;opacity:0.5;gap:0.5rem;">
                    <i data-lucide="check-circle" style="width:40px;height:40px;"></i>
                    <p style="font-size:0.9rem;">Nenhuma saída no mês.</p>
                </div>`;
            lucide.createIcons();
            return;
        }

        items.sort((a, b) => new Date(a.date) - new Date(b.date));
        items.forEach(item => {
            const day = item.date.split('-')[2] || '--';
            const li = document.createElement('li');
            li.className = `upcoming-item ${item.isParcelado ? 'parcelado' : ''}`;
            li.innerHTML = `
                <div class="upcoming-info">
                    <i data-lucide="${item.isParcelado ? 'credit-card' : 'receipt'}" class="${item.isParcelado ? 'text-warning' : 'text-danger'}"></i>
                    <div>
                        <div class="upcoming-title">${item.title}</div>
                        <div class="upcoming-date">Vencimento: dia ${day}</div>
                    </div>
                </div>
                <div class="upcoming-value text-danger">-${app.formatCurrency(item.value)}</div>
            `;
            listEl.appendChild(li);
        });
        lucide.createIcons();
    },

    renderProjectionChart: (investimentos, basePatrimonio) => {
        const ctx = document.getElementById('projectionChart');
        if (!ctx) return;
        if (app.projectionChartInstance) app.projectionChartInstance.destroy();
        if (!investimentos || investimentos.length === 0) return;

        const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
        const today = new Date();
        const monthsLabels = [];
        const projData = [];

        for (let i = 0; i <= 12; i++) {
            let runningSum = 0;
            investimentos.forEach(inv => {
                const taxa = (inv.taxaAnual || 0) / 12 / 100;
                runningSum += inv.saldoAtual * Math.pow(1 + taxa, i);
            });
            projData.push(runningSum.toFixed(2));
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
                    backgroundColor: 'rgba(74,222,128,0.1)',
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
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => 'Patrimônio: ' + app.formatCurrency(parseFloat(ctx.raw))
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.6)', font: { family: "'Outfit', sans-serif" } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.6)', font: { family: "'Outfit', sans-serif" } }
                    }
                }
            }
        });
    },

    // ─── Tabela de Transações (Fix #5 editar, Fix #6 busca) ──────────────────
    renderTransactionsTable: (transacoes) => {
        const tbody = document.querySelector('#table-transactions tbody');
        const emptyState = document.getElementById('empty-state-transactions');
        const table = document.getElementById('table-transactions');
        if (!tbody) return;

        tbody.innerHTML = '';

        let filtered = transacoes.filter(t => t.data.startsWith(app.currentMonth) || t.fixo);

        // Fix #1: garante que fixos futuros não aparecem
        filtered = filtered.filter(t => {
            if (!t.fixo) return true;
            const [tY, tM] = t.data.split('-').map(Number);
            const [cY, cM] = app.currentMonth.split('-').map(Number);
            return !((tY > cY) || (tY === cY && tM > cM));
        });

        // Fix #6: filtro de busca
        if (app.searchQuery) {
            filtered = filtered.filter(t =>
                (t.descricao || '').toLowerCase().includes(app.searchQuery) ||
                (t.categoria || '').toLowerCase().includes(app.searchQuery)
            );
        }

        if (filtered.length === 0) {
            emptyState.style.display = 'flex';
            table.style.display = 'none';
            return;
        }
        emptyState.style.display = 'none';
        table.style.display = 'table';

        filtered.sort((a, b) => new Date(b.data) - new Date(a.data));

        filtered.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${app.formatDate(t.data)}</td>
                <td><strong>${t.descricao}</strong></td>
                <td>${t.categoria || '-'}</td>
                <td><span class="badge ${t.tipo === 'Receita' ? 'badge-receita' : 'badge-despesa'}">${t.tipo}</span></td>
                <td><span class="badge ${t.fixo ? 'badge-sim' : 'badge-nao'}">${t.fixo ? 'Fixo' : 'Pontual'}</span></td>
                <td class="${t.tipo === 'Receita' ? 'text-success' : 'text-danger'}">
                    ${t.tipo === 'Receita' ? '+' : '-'}${app.formatCurrency(t.valor)}
                </td>
                <td style="white-space:nowrap;">
                    <button class="btn-icon" onclick="window.app.editTransaction(${t.id})" title="Editar">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="btn-icon delete" onclick="window.app.deleteTransaction(${t.id})" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    },

    // Fix #5: editar transação
    editTransaction: async (id) => {
        const t = await db.transacoes.get(id);
        if (!t) return;
        app.editingTransactionId = id;

        if (t.tipo === 'Receita') {
            app.openModal('modal-receita');
            const f = document.getElementById('form-receita');
            f.querySelector('[name="descricao"]').value = t.descricao;
            f.querySelector('[name="valor"]').value = t.valor;
            f.querySelector('[name="data"]').value = t.data;
            const btn = f.querySelector('button[type="submit"]');
            if (btn) btn.textContent = 'Salvar Alterações';
        } else {
            app.openModal('modal-transaction');
            const f = document.getElementById('form-transaction');
            f.querySelector('[name="descricao"]').value = t.descricao;
            f.querySelector('[name="valor"]').value = t.valor;
            f.querySelector('[name="tipo"]').value = t.tipo;
            f.querySelector('[name="data"]').value = t.data;
            f.querySelector('[name="fixo"]').value = t.fixo ? 'Sim' : 'Não';
            f.querySelector('[name="categoria"]').value = t.categoria || '';
        }
    },

    renderInstallmentsTable: (parcelamentos) => {
        const tbody = document.querySelector('#table-installments tbody');
        const emptyState = document.getElementById('empty-state-installments');
        const table = document.getElementById('table-installments');
        if (!tbody) return;

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

            let progressoHtml = '';
            if (p.status === 'Finalizado') {
                progressoHtml = `<span class="text-muted">Quitado</span>`;
            } else if (parcelaAtual <= 0) {
                progressoHtml = `<span class="text-muted">Inicia em ${app.formatDate(p.mesInicio)}</span>`;
            } else if (parcelaAtual > p.qtdParcelas) {
                progressoHtml = `<span class="text-success">Concluído</span>`;
            } else {
                const pct = Math.round((parcelaAtual / p.qtdParcelas) * 100);
                progressoHtml = `
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <span class="text-warning" style="font-size:0.85rem;">Parcela ${parcelaAtual} de ${p.qtdParcelas}</span>
                        <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;width:100px;">
                            <div style="height:4px;background:var(--warning);border-radius:2px;width:${pct}%;"></div>
                        </div>
                    </div>`;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${p.item}</strong></td>
                <td>${app.formatDate(p.mesInicio)}</td>
                <td>${progressoHtml}</td>
                <td>${app.formatCurrency(p.valorTotal)}</td>
                <td class="text-warning">${app.formatCurrency(p.valorParcela)} / mês</td>
                <td><span class="badge ${p.status === 'Ativo' ? 'badge-ativo' : 'badge-finalizado'}">${p.status}</span></td>
                <td style="white-space:nowrap;">
                    <button class="btn-icon" onclick="window.app.toggleStatus(${p.id}, '${p.status}')" title="${p.status === 'Ativo' ? 'Quitar' : 'Reativar'}">
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

    // Fix #5: editar investimento
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

        const getBadgeClass = (tipo) => {
            const map = { 'Conta Corrente': 'badge-cc', 'Poupança': 'badge-poupanca', 'CDB': 'badge-cdb', 'Ações': 'badge-acoes' };
            return map[tipo] || 'badge-nao';
        };

        investimentos.forEach(i => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${i.instituicao}</strong></td>
                <td><span class="badge ${getBadgeClass(i.tipoAtivo)}">${i.tipoAtivo}</span></td>
                <td class="text-accent">${app.formatCurrency(i.saldoAtual)}</td>
                <td>${app.formatDate(i.ultimaAtualizacao)}</td>
                <td style="white-space:nowrap;">
                    <button class="btn-icon" onclick="window.app.editInvestment(${i.id})" title="Editar">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="btn-icon delete" onclick="window.app.deleteInvestment(${i.id})" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    },

    editInvestment: async (id) => {
        const i = await db.investimentos.get(id);
        if (!i) return;
        app.editingInvestmentId = id;
        app.openModal('modal-investment');
        const f = document.getElementById('form-investment');
        f.querySelector('[name="instituicao"]').value = i.instituicao;
        f.querySelector('[name="tipoAtivo"]').value = i.tipoAtivo;
        f.querySelector('[name="saldoAtual"]').value = i.saldoAtual;
        f.querySelector('[name="taxaAnual"]').value = i.taxaAnual || 0;
        f.querySelector('[name="ultimaAtualizacao"]').value = i.ultimaAtualizacao;
        const btn = f.querySelector('button[type="submit"]');
        if (btn) btn.textContent = 'Salvar Alterações';
    },

    // ─── Deleções (Fix #3: usa showConfirm) ──────────────────────────────────
    deleteTransaction: (id) => {
        app.showConfirm('Essa transação será removida permanentemente.', async () => {
            try {
                await db.transacoes.delete(id);
                app.renderAll();
            } catch (err) {
                app.showToast('Erro ao excluir', err.message, 'error');
            }
        });
    },

    deleteInstallment: (id) => {
        app.showConfirm('Esse parcelamento será removido permanentemente.', async () => {
            try {
                await db.parcelamentos.delete(id);
                app.renderAll();
            } catch (err) {
                app.showToast('Erro ao excluir', err.message, 'error');
            }
        });
    },

    deleteInvestment: (id) => {
        app.showConfirm('Essa conta ou investimento será removido permanentemente.', async () => {
            try {
                await db.investimentos.delete(id);
                app.renderAll();
            } catch (err) {
                app.showToast('Erro ao excluir', err.message, 'error');
            }
        });
    },

    toggleStatus: async (id, currentStatus) => {
        const newStatus = currentStatus === 'Ativo' ? 'Finalizado' : 'Ativo';
        await db.parcelamentos.update(id, { status: newStatus });
        app.renderAll();
    },

    // ─── Exportar / Importar (Fix #9) ────────────────────────────────────────
    exportData: async () => {
        try {
            const transacoes    = await db.transacoes.toArray();
            const parcelamentos = await db.parcelamentos.toArray();
            const investimentos = await db.investimentos.toArray();

            const payload = {
                exportedAt: new Date().toISOString(),
                version: 3,
                transacoes,
                parcelamentos,
                investimentos
            };

            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `ifinance-backup-${date}.json`;
            a.click();
            URL.revokeObjectURL(url);
            app.showToast('Backup exportado', 'Arquivo JSON salvo com sucesso.');
        } catch (err) {
            app.showToast('Erro ao exportar', err.message, 'error');
        }
    },

    importData: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);

                if (!data.transacoes || !data.parcelamentos || !data.investimentos) {
                    app.showToast('Arquivo inválido', 'O JSON não parece ser um backup do IFinance.', 'error');
                    return;
                }

                app.showConfirm(
                    `Isso irá SUBSTITUIR todos os dados atuais pelos dados do backup de ${data.exportedAt?.slice(0,10) || 'data desconhecida'}. Continuar?`,
                    async () => {
                        try {
                            await db.transacoes.clear();
                            await db.parcelamentos.clear();
                            await db.investimentos.clear();
                            await db.transacoes.bulkAdd(data.transacoes.map(({ id, ...rest }) => rest));
                            await db.parcelamentos.bulkAdd(data.parcelamentos.map(({ id, ...rest }) => rest));
                            await db.investimentos.bulkAdd(data.investimentos.map(({ id, ...rest }) => rest));
                            app.renderAll();
                            app.showToast('Backup importado', `${data.transacoes.length} transações restauradas.`);
                        } catch (err) {
                            app.showToast('Erro ao importar', err.message, 'error');
                        }
                    }
                );
            } catch (err) {
                app.showToast('Erro ao ler arquivo', 'JSON inválido ou corrompido.', 'error');
            }
        };
        input.click();
    },

    // ─── Loop principal ───────────────────────────────────────────────────────
    renderAll: async () => {
        const [transacoes, parcelamentos, investimentos] = await Promise.all([
            db.transacoes.toArray(),
            db.parcelamentos.toArray(),
            db.investimentos.toArray()
        ]);
        app.renderDashboard(transacoes, parcelamentos, investimentos);
        app.renderTransactionsTable(transacoes);
        app.renderInstallmentsTable(parcelamentos);
        app.renderInvestmentsTable(investimentos);
    },

    updateMonthDisplay: () => {
        const el = document.getElementById('month-display');
        if (!el) return;
        const [year, month] = app.currentMonth.split('-').map(Number);
        const name = new Date(year, month - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        el.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    },

    changeMonth: (delta) => {
        const [year, month] = app.currentMonth.split('-').map(Number);
        const date = new Date(year, month - 1 + delta, 1);
        app.currentMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        app.updateMonthDisplay();
        app.renderAll();
    },

    init: () => {
        app.updateMonthDisplay();
        app.setupFormListeners();
        app.renderAll();
        lucide.createIcons();
    }
};

window.app = app;
document.addEventListener('DOMContentLoaded', app.init);
