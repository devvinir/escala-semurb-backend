import express from 'express'
import bcrypt from 'bcrypt'
import supabase from '../../supabase.js'

const route = express.Router()

// Função para validar campos obrigatórios
function validarCampos(campos, body) {
  for (const campo of campos) {
    if (!body[campo]) return campo
  }
  return null
}

async function criarNotificacao({
  registration = null,
  tipo_notificacao = 'GENÉRICA',
  mensagem = '',
  matricula_responsavel = null
}) {
  try {
    const { error } = await supabase.from('notificacoes').insert([
      {
        registration,
        tipo_notificacao,
        mensagem,
        matricula_responsavel,
        lida: false,
        enviada_em: new Date().toISOString()
      }
    ])
    if (error) {
      // não interrompe a operação principal, apenas loga
      console.error('Erro ao criar notificação:', error)
    }
  } catch (err) {
    console.error('Erro inesperado ao criar notificação:', err)
  }
}

//contabilizar funcionarios por sector para grafico
route.get('/contabilizarFuncionariosSetor', async (req, res) => {
  try {
    // buscar todos os funcionários trazendo id_sector e relacionamento sector.name
    const { data, error } = await supabase
    .from('employee')
    .select('id_sector, sector(name)')

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao buscar funcionários', erro: error })
    }

    // agregar contagem por sector (funcionários sem sector aparecem como "Sem sector" com id_sector = null)
    const mapa = new Map()
    for (const f of data || []) {
      const id = f.id_sector ?? null
      const name = f.sector?.name ?? 'Sem sector'
      const key = id === null ? 'null' : String(id)

      if (!mapa.has(key)) {
        mapa.set(key, { id: id, name: name, quantidade: 0 })
      }
      mapa.get(key).quantidade += 1
    }

    const contagem = Array.from(mapa.values())
    return res.status(200).json(contagem)
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

//listar equipes
route.get('/listarEquipes_master', async (req, res) => {
  try {
    const { data, error } = await supabase.from('team').select('*')

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao listar teams', erro: error })
    }

    res.status(200).json({ teams: data })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// listar regioes
route.get('/listarRegioes_master', async (req, res) => {
  try {
    const { data, error } = await supabase.from('region').select('*')

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao listar regiões', erro: error })
    }

    res.status(200).json({ regioes: data })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Cadastrar Funcionário
route.post('/cadastrarFuncionario_master', async (req, res) => {
  try {
    const {
      registration,
      name,
      email,
      phone,
      position,
      sector,
      is_admin,
      team,
      region
    } = req.body

    if (
      !registration ||
      !name ||
      !email ||
      !phone ||
      !position ||
      !sector ||
      !is_admin ||
      !team ||
      !region
    ) {
      return res.status(400).json({ mensagem: 'Preencha todos os campos obrigatórios' })
    }

    //verificar se matricula possui 5 digitos
    if (String(req.body.registration).length !== 5) {
      return res.status(400).json({ mensagem: 'A matrícula deve conter exatamente 5 dígitos' })
    }

    const password = registration.toString()

    // Criptografar password
    const salt = await bcrypt.genSalt(10)
    const passwordHash = await bcrypt.hash(password, salt)

    // Verificar se matrícula já existe
    const { data: funcionarioExistente } = await supabase
      .from('employee')
      .select('*')
      .eq('registration', registration)
      .maybeSingle()

    if (funcionarioExistente) {
      return res.status(400).json({ mensagem: 'Matrícula já cadastrada' })
    }

    // buscar sector para associar ao funcionário
    const { data: sectorData, error: sectorError } = await supabase
      .from('sector')
      .select('id')
      .eq('name', sector)
      .maybeSingle()

    if (sectorError || !sectorData) {
      return res.status(400).json({ mensagem: 'sector não encontrado', erro: sectorError })
    }

    //buscar team do sector para associar ao funcionário
    const { data: teamData, error: teamError } = await supabase
      .from('team')
      .select('id')
      .eq('name', team)
      .eq('id', sectorData.id)
      .maybeSingle()

    if (teamError) {
      return res.status(400).json({ mensagem: 'Erro ao buscar team', erro: teamError })
    } else if (!teamData) {
      const { data: novateamData, error: novateamError } = await supabase
        .from('team')
        .insert([{ name: team, id_sector: sectorData.id }])
        .select()
        .maybeSingle()

      if (novateamError) {
        return res
          .status(400)
          .json({ mensagem: 'Erro ao criar nova team', erro: novateamError })
      }

      teamData.id = novateamData.id
    }

    //buscar região e se nao existir criar outra
    const { data: regionData, error: regionError } = await supabase
      .from('region')
      .select('id')
      .eq('name', region)
      .maybeSingle()

    if (regionError) {
      return res.status(400).json({ mensagem: 'Erro ao buscar region', erro: regionError })
    } else if (!regionData) {
      const { data: novaregionData, error: novaregionError } = await supabase
        .from('region')
        .insert([{ name: region }])
        .select()
        .maybeSingle()

      if (novaregionError) {
        return res
          .status(400)
          .json({ mensagem: 'Erro ao criar nova region', erro: novaregionError })
      }

      regionData.id = novaregionData.id
    }

    // Inserir funcionário
    const { data, error } = await supabase
      .from('employee')
      .insert([
        {
          registration: registration,
          name: name,
          email: email,
          password: passwordHash,
          phone: phone,
          position: position,
          id_team: teamData.id,
          id_region: regionData.id,
          id_sector: sectorData.id,
          is_admin: is_admin
        }
      ])
      .select()

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao inserir dados', erro: error })
    }

    res.status(201).json({ mensagem: 'Funcionário cadastrado com sucesso', funcionario: data[0] })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Listar Funcionários
route.get('/listarFuncionarios_master', async (req, res) => {
  try {
    const { data, error } = await supabase
    .from('employee').select('*')

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao listar funcionários', erro: error })
    }

    res.status(200).json({ funcionarios: data })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Editar funcionário (dados e permissão, sem password)
route.put('/editarFuncionario_master/:registration', async (req, res) => {
  try {
    const { registration } = req.params
    const { email, phone, position, sector, is_admin, team, region } = req.body

    const { data: funcionarioDesatualizado } = await supabase
      .from('employee')
      .select('*')
      .eq('registration', registration)
      .maybeSingle()

    if (!funcionarioDesatualizado) {
      console.log('Funcionário não encontrado.')
      return res.status(404).json({ mensagem: 'Funcionário não encontrado' })
    }

    let id_sector = funcionarioDesatualizado.id_sector
    if (sector) {
      const { data: sectorData, error: sectorError } = await supabase
        .from('sector')
        .select('id_sector')
        .eq('name', sector)
        .maybeSingle()

      if (sectorError || !sectorData) {
        console.log('sector não encontrado:', sector)
        return res.status(400).json({ mensagem: 'sector não encontrado', erro: sectorError })
      }

      id_sector = sectorData.id_sector
    }

    //verificar se team existe no sector do funcionário e atualizar se necessário
    const { data: teamData, error: teamError } = await supabase
      .from('team')
      .select('id_team')
      .eq('nome_team', team)
      .eq('id_sector', id_sector)
      .maybeSingle()

    if (teamError) {
      console.log('Erro ao buscar team:', teamError)
      return res.status(400).json({ mensagem: 'Erro ao buscar team', erro: teamError })
    } else if (team && !teamData) {
      console.log('team não encontrada no sector:', team)
      return res.status(400).json({ mensagem: 'team não encontrada no sector' })
    }

    // verificar region e atualizar se necessário
    let id_region = funcionarioDesatualizado.id_region
    if (region) {
      const { data: regionData, error: regionError } = await supabase
        .from('region')
        .select('id_region')
        .eq('nome_region', region)
        .maybeSingle()

      if (regionError) {
        console.log('Erro ao buscar region:', regionError)
        return res.status(400).json({ mensagem: 'Erro ao buscar region', erro: regionError })
      } else if (!regionData) {
        console.log('region não encontrada:', region)
        return res.status(400).json({ mensagem: 'region não encontrada' })
      }
      id_region = regionData.id_region
    }

    const payloadToUpdate = {
      email: email !== undefined ? email : funcionarioDesatualizado.email,
      phone: phone !== undefined ? phone : funcionarioDesatualizado.phone,
      position: position !== undefined ? position : funcionarioDesatualizado.position,
      id_sector: id_sector,
      is_admin:
        is_admin !== undefined
          ? is_admin
          : funcionarioDesatualizado.is_admin,
      id_team: teamData ? teamData.id_team : funcionarioDesatualizado.team,
      id_region: id_region
    }

    const { data: funcionarioAtualizado, error } = await supabase
      .from('employee')
      .update(payloadToUpdate)
      .eq('registration', registration)
      .select('email, phone, position, is_admin, sector(name)')
      .maybeSingle()

    if (error) {
      console.log('Erro ao atualizar funcionário:', error)
      return res.status(400).json({ mensagem: 'Erro ao atualizar funcionário', erro: error })
    }

    return res.status(200).json({
      mensagem: 'Funcionário atualizado com sucesso',
      funcionario: funcionarioAtualizado[0]
    })
  } catch (error) {
    console.error('Erro inesperado:', error)
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Deletar Funcionário
route.delete('/deletarFuncionario_master/:registration', async (req, res) => {
  try {
    const { registration } = req.params

    // apaga as notificacoes do funcoinario primeiro
    const { error: notifError } = await supabase
      .from('notificacoes')
      .delete()
      .eq('registration', registration)

    if (notifError) {
      return res.status(400).json({ mensagem: 'Erro ao deletar notificações', erro: notifError })
    }

    // depois apaga confirmacoes
    const { error: confirmError } = await supabase
      .from('escala_confirmacao')
      .delete()
      .eq('registration', registration)

    if (confirmError) {
      return res.status(400).json({ mensagem: 'Erro ao deletar conformações', erro: confirmError })
    }

    //depois apaga o funcionario
    const { error: funcError } = await supabase
      .from('employee')
      .delete()
      .eq('registration', registration)

    if (funcError) {
      return res.status(400).json({ mensagem: 'Erro ao deletar funcionário', erro: funcError })
    }

    res.status(200).json({ mensagem: 'Funcionário deletado com sucesso' })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// escala

// Cadastrar escala e vincular ao funcionário
// POST /cadastrarEscala
route.post('/cadastrarEscala_master', async (req, res) => {
  const obrigatorios = ['registration', 'start_date', 'scale_type']
  const campoFaltando = validarCampos(obrigatorios, req.body)
  if (campoFaltando)
    return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })

  try {
    const {
      registration,
      start_date,
      scale_type,
      unwork_scale,
      use_occasion
    } = req.body

    // Interpretar escala tipo NxM
const padrao = /^(\d{1,2})x(\d{1,2})$/
const match = scale_type.match(padrao)
if (!match)
  return res.status(400).json({ mensagem: 'Tipo de escala inválido' })

let n = parseInt(match[1], 10)
let m = parseInt(match[2], 10)

// Corrige tratamento de escalas em horas (ex: 12x36, 24x48, etc.)
//
// Lógica:
// - Se N ou M > 7 → assume-se que são horas.
// - A cada ciclo (N + M horas), calcula-se quantos dias o ciclo representa.
// - A partir disso, define-se 1 dia trabalhado para escalas de até 24h trabalhadas.
// - E calcula 1 dia de folga se a folga for >= 24h.
if (n > 7 || m > 7) {
  const cicloHoras = n + m
  const cicloDias = cicloHoras / 24

  // Se for uma escala horária curta (12x36, 24x48, etc.)
  // consideramos 1 dia trabalhado e 1 dia de folga por ciclo
  if (cicloDias <= 3) {
    n = 1
    m = 1
  } else {
    // Escalas mais longas (ex: 24x72 → 1x3)
    n = 1
    m = Math.round((m / n))
  }
}

// Verifica se precisa de dias específicos
const precisa_occasion = use_occasion === 'SIM'

if (precisa_occasion) {
  const diasArray = Array.isArray(unwork_scale)
    ? unwork_scale
    : []

  if (diasArray.length === 0)
    return res.status(400).json({ mensagem: 'Informe os dias específicos de folga.' })

  // Agora aceita nomes completos e abreviações
  const diasValidos = [
    'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado',
    'Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'
  ]

  const diasInvalidos = diasArray.filter(d => !diasValidos.includes(d))
  if (diasInvalidos.length > 0)
    return res.status(400).json({ mensagem: `Dias inválidos: ${diasInvalidos.join(', ')}` })

  // Normaliza abreviações (opcional)
  const mapDias = {
    Dom: 'Domingo', Seg: 'Segunda', Ter: 'Terça', Qua: 'Quarta',
    Qui: 'Quinta', Sex: 'Sexta', Sab: 'Sábado'
  }
  const diasNormalizados = diasArray.map(d => mapDias[d] || d)

  if (diasNormalizados.length !== m)
    return res.status(400).json({
      mensagem: `Quantidade de dias não trabalhados (${m}) difere dos dias informados (${diasNormalizados.length}).`
    })
}
    // Verificar funcionário
    const { data: funcionarioExistente } = await supabase
      .from('employee')
      .select('*')
      .eq('registration', registration)
      .maybeSingle()
    if (!funcionarioExistente)
      return res.status(400).json({ mensagem: 'Funcionário não encontrado' })

    // verificar se funcionario ja possui escala
    if (funcionarioExistente.id_scale) {
      return res.status(400).json({ mensagem: 'Funcionário já possui uma escala vinculada' })
    }

    // Inserir escala
    const { data: escalaCriada, error: errorEscala } = await supabase
      .from('scale')
      .insert([
        {
          start_date,
          scale_type,
          work_day: n,
          unwork_day: m,
          unwork_scale: precisa_occasion
            ? unwork_scale
            : null
        }
      ])
      .select()
      .single()

    if (errorEscala) {
      return res.status(400).json({ mensagem: 'Erro ao inserir escala', erro: errorEscala })
    }

    // Vincular escala ao funcionário
    const { error: errorVinculo } = await supabase
      .from('employee')
      .update({ id_scale: escalaCriada.id_scale })
      .eq('registration', registration)

    if (errorVinculo) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao vincular escala ao funcionário', erro: errorVinculo })
    }

    // notificar criação de escala
    await criarNotificacao({
      registration,
      tipo_notificacao: 'Nova Escala',
      mensagem: `Sua nova escala foi cadastrada: Início em ${start_date}, Tipo: ${scale_type}. Por favor, confirme o recebimento da escala no sistema.`,
    })

    // confirmacao

    const { data: confirmacaoCriada, error: errorConfirmacao } = await supabase
      .from('escala_confirmacao')
      .insert([
        {
          registration: funcionarioExistente.registration,
          id_scale: escalaCriada.id
        }
      ])
      .select('*')
      .single()

    if (errorConfirmacao) {
      console.error('Erro ao criar confirmação da escala:', errorConfirmacao)
      // opcional: desfazer escala criada ou retornar erro
      return res.status(400).json({ mensagem: 'Erro ao criar confirmação da escala', erro: errorConfirmacao })
    }

    // Vincular o id da confirmação (id_confirmacao) ao funcionário
    const { error: errorVinculoConfirm } = await supabase
      .from('employee')
      .update({ id_confirmacao: confirmacaoCriada.id_confirmacao })
      .eq('registration', funcionarioExistente.registration)

    if (errorVinculoConfirm) {
      console.error('Erro ao vincular confirmação ao funcionário:', errorVinculoConfirm)
      // não interromper necessariamente, mas informar
    }

    return res.status(201).json({ mensagem: 'Escala cadastrada com sucesso', escala: escalaCriada })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// PUT /alterarEscala
route.put('/alterarEscala_master', async (req, res) => {
  const obrigatorios = ['registration', 'start_date', 'scale_type']
  const campoFaltando = validarCampos(obrigatorios, req.body)
  if (campoFaltando)
    return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })

  try {
    const {
      registration,
      start_date,
      scale_type,
      unwork_scale,
      use_occasion
    } = req.body

        // Interpretar escala tipo NxM
const padrao = /^(\d{1,2})x(\d{1,2})$/
const match = scale_type.match(padrao)
if (!match)
  return res.status(400).json({ mensagem: 'Tipo de escala inválido' })

let n = parseInt(match[1], 10)
let m = parseInt(match[2], 10)

// Corrige tratamento de escalas em horas (ex: 12x36, 24x48, etc.)
//
// Lógica:
// - Se N ou M > 7 → assume-se que são horas.
// - A cada ciclo (N + M horas), calcula-se quantos dias o ciclo representa.
// - A partir disso, define-se 1 dia trabalhado para escalas de até 24h trabalhadas.
// - E calcula 1 dia de folga se a folga for >= 24h.
if (n > 7 || m > 7) {
  const cicloHoras = n + m
  const cicloDias = cicloHoras / 24

  // Se for uma escala horária curta (12x36, 24x48, etc.)
  // consideramos 1 dia trabalhado e 1 dia de folga por ciclo
  if (cicloDias <= 3) {
    n = 1
    m = 1
  } else {
    // Escalas mais longas (ex: 24x72 → 1x3)
    n = 1
    m = Math.round((m / n))
  }
}

// Verifica se precisa de dias específicos
const precisa_occasion = use_occasion === 'SIM'

if (precisa_occasion) {
  const diasArray = Array.isArray(unwork_scale)
    ? unwork_scale
    : []

  if (diasArray.length === 0)
    return res.status(400).json({ mensagem: 'Informe os dias específicos de folga.' })

  // Agora aceita nomes completos e abreviações
  const diasValidos = [
    'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado',
    'Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'
  ]

  const diasInvalidos = diasArray.filter(d => !diasValidos.includes(d))
  if (diasInvalidos.length > 0)
    return res.status(400).json({ mensagem: `Dias inválidos: ${diasInvalidos.join(', ')}` })

  // Normaliza abreviações (opcional)
  const mapDias = {
    Dom: 'Domingo', Seg: 'Segunda', Ter: 'Terça', Qua: 'Quarta',
    Qui: 'Quinta', Sex: 'Sexta', Sab: 'Sábado'
  }
  const diasNormalizados = diasArray.map(d => mapDias[d] || d)

  if (diasNormalizados.length !== m)
    return res.status(400).json({
      mensagem: `Quantidade de dias não trabalhados (${m}) difere dos dias informados (${diasNormalizados.length}).`
    })
}

    // Verificar funcionário e sector
    const { data: funcionarioExistente } = await supabase
      .from('employee')
      .select('*')
      .eq('registration', registration)
      .maybeSingle()
    if (!funcionarioExistente)
      return res.status(400).json({ mensagem: 'Funcionário não encontrado' })
    if (!funcionarioExistente.id_scale)
      return res.status(400).json({ mensagem: 'Funcionário não possui escala vinculada' })

    // Alterar escala
    const { data: escalaAtualizada, error } = await supabase
      .from('scale')
      .update({
        start_date,
        scale_type,
        work_day: n,
        unwork_day: m,
        unwork_scale: precisa_occasion
          ? unwork_scale
          : [],
        use_occasion: precisa_occasion
      })
      .eq('id', funcionarioExistente.id_scale)
      .select()
      .single()

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao atualizar escala', erro: error })
    }

    // notificar alteração de escala
    await criarNotificacao({
      registration,
      tipo_notificacao: 'Atualização de Escala',
      mensagem: `Sua escala foi atualizada: Início em ${start_date}, Tipo: ${scale_type}. Por favor, confirme o recebimento da escala no sistema.`,
    })

    // confirmacao

     // remover confirmação antiga (se existir) associada à escala anterior do funcionário
        if (funcionarioExistente.id_scale) {
          const { error: errorDeletar } = await supabase
            .from('escala_confirmacao')
            .delete()
            .eq('id_scale', funcionarioExistente.id_scale)
            .eq('registration', funcionarioExistente.registration)
    
        // criar nova confirmação para a escala atualizada
        const { data: confirmacaoCriada, error: errorConfirmacao } = await supabase
          .from('escala_confirmacao')
          .insert([
            {
              registration: funcionarioExistente.registration,
              id_scale: escalaAtualizada.id_scale
            }
          ])
          .select('*')
          .single()
    
        if (errorConfirmacao) {
          console.error('Erro ao criar confirmação da escala atualizada:', errorConfirmacao)
          return res.status(400).json({ mensagem: 'Erro ao criar confirmação da escala', erro: errorConfirmacao })
        }
    
        // atualizar o funcionário para apontar para a nova confirmação (usar id_confirmacao retornado)
        const { error: errorAtualizarFunc } = await supabase
          .from
          ('employee')
          .update({ id_confirmacao: confirmacaoCriada.id_confirmacao })
          .eq('registration', funcionarioExistente.registration)
    
        if (errorAtualizarFunc) {
          console.error('Erro ao atualizar funcionário com nova confirmação:', errorAtualizarFunc)
        }
    
          if (errorDeletar) {
            console.error('Erro ao deletar confirmação antiga:', errorDeletar)
          }
        }

    return res
      .status(200)
      .json({ mensagem: 'Escala alterada com sucesso', escala: escalaAtualizada })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

route.get('/listarEscalas_master', async (req, res) => {
  try {
    const { data, error } = await supabase
    .from('scale').select('*')

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao listar escalas', erro: error })
    }
    res.status(200).json({ escalas: data })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// turno
// cadastrar turno e vincular ao funcionário
route.post('/cadastrarTurno_master', async (req, res) => {
  try {
    const obrigatorios = [
      'registration',
      'inicio_turno',
      'termino_turno',
      'duracao_turno',
      'intervalo_turno'
    ]
    const campoFaltando = validarCampos(obrigatorios, req.body)
    if (campoFaltando) {
      return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })
    }

    const { registration, inicio_turno, termino_turno, duracao_turno, intervalo_turno } =
      req.body

    // Verificar se funcionário existe
    const { data: funcionarioExistente, error: errorFuncionario } = await supabase
      .from('employee')
      .select('*')
      .eq('registration', registration)
      .maybeSingle()

    if (errorFuncionario) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao buscar funcionário', erro: errorFuncionario })
    }
    if (!funcionarioExistente) {
      return res.status(400).json({ mensagem: 'Matrícula do funcionário não encontrada' })
    }

    // garantir que o funcionario possua escala antes de buscar turnos
    if (!funcionarioExistente.id_scale) {
      return res.status(400).json({
        mensagem:
          'Funcionário não possui escala vinculada. Cadastre uma escala antes de adicionar um turno.'
      })
    }

    // verificar se o funcionario já possui um turno vinculado
    if (funcionarioExistente.id_turno) {
      return res.status(400).json({ mensagem: 'Funcionário já possui um turno vinculado' })
    }

    // Inserir turno
    const { data: turnoCriado, error: errorTurno } = await supabase
      .from('shift')
      .insert([{ inicio_turno, termino_turno, duracao_turno, intervalo_turno }])
      .select('*')
      .single()

    if (errorTurno) {
      return res.status(400).json({ mensagem: 'Erro ao inserir turno', erro: errorTurno })
    }

    // Vincular turno criado ao funcionário
    const { data: turnoVinculado, error: errorVinculo } = await supabase
      .from('employee')
      .update({ id_turno: turnoCriado.id_turno })
      .eq('registration', registration)
      .select('*')
      .single()

    if (errorVinculo) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao vincular turno ao funcionário!', erro: errorVinculo })
    }

    // notificar criação de turno
    await criarNotificacao({
      registration,
      tipo_notificacao: 'Novo Turno',
      mensagem: `Seu novo turno foi cadastrado: ${inicio_turno} - ${termino_turno}.`,
    })

    res.status(201).json({
      mensagem: 'Turno cadastrado e vinculado com sucesso',
      turno: turnoCriado,
      funcionario: turnoVinculado
    })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

route.put('/alterarTurno_master', async (req, res) => {
  try {
    const obrigatorios = [
      'registration',
      'inicio_turno',
      'termino_turno',
      'duracao_turno',
      'intervalo_turno'
    ]
    const campoFaltando = validarCampos(obrigatorios, req.body)
    if (campoFaltando) {
      return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })
    }

    const { registration, inicio_turno, termino_turno, duracao_turno, intervalo_turno } =
      req.body

    // Verificar se funcionário existe
    const { data: funcionarioExistente, error: errorFuncionario } = await supabase
      .from('employee')
      .select('*')
      .eq('registration', registration)
      .maybeSingle()

    if (errorFuncionario) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao buscar funcionário', erro: errorFuncionario })
    }
    if (!funcionarioExistente) {
      return res.status(400).json({ mensagem: 'Matrícula do funcionário não encontrada' })
    }

    // garantir que o funcionario possua turno antes de alterar
    if (!funcionarioExistente.id_turno) {
      return res.status(400).json({
        mensagem:
          'Funcionário não possui turno vinculado. Cadastre um turno antes de tentar alterá-lo.'
      })
    }

    // Alterar turno
    const { data: turnoAtualizado, error: errorTurno } = await supabase
      .from('shift')
      .update({ inicio_turno, termino_turno, duracao_turno, intervalo_turno })
      .eq('id_turno', funcionarioExistente.id_turno)
      .select('*')
      .single()

    if (errorTurno) {
      return res.status(400).json({ mensagem: 'Erro ao alterar turno', erro: errorTurno })
    }

    // notificar alteração de turno
    await criarNotificacao({
      registration,
      tipo_notificacao: 'Atualização de Turno',
      mensagem: `Seu turno foi atualizado: ${inicio_turno} - ${termino_turno}.`,
    })

    res.status(200).json({
      mensagem: 'Turno alterado com sucesso',
      turno: turnoAtualizado
    })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

route.get('/listarTurnos_master', async (req, res) => {
  try {
    const { data, error } = await supabase
    .from('shift')
    .select('*')

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao listar turnos', erro: error })
    }
    res.status(200).json({ turnos: data })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

//sectors

// Criar sector
route.post('/cadastrarSetor', async (req, res) => {
  try {
    const { name } = req.body

    if (!name) {
      return res.status(400).json({ mensagem: 'Informe o name do sector' })
    }

    // Verificar se já existe
    const { data: sectorExistente } = await supabase
      .from('sector')
      .select('*')
      .eq('name', name)
      .maybeSingle()

    if (sectorExistente) {
      return res.status(400).json({ mensagem: 'sector já cadastrado' })
    }

    const { data, error } = await supabase
    .from('sector')
    .insert([{ name: name }])
    .select('*')

    if (error) {
        console.log(error.message)
      return res.status(400).json({ mensagem: 'Erro ao cadastrar sector', erro: error.message })
    }
    const sector_name = name;
    //criar equipe padrao de adm no setor
    await supabase
    .from('team')
    .insert([{ name: `${sector_name}(ADM)`, id_sector: data[0].id }])

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao criar team padrão do sector', erro: error })
    }

    res.status(201).json({ mensagem: 'sector cadastrado com sucesso', sector: data[0] })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Listar sectors
route.get('/listarSetores', async (req, res) => {
  try {
    const { data, error } = await supabase
    .from('sector')
    .select('*')

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao listar setores', erro: error })
    }

    res.status(200).json({ sectors: data })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Editar sector
route.put('/editarSetor/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name } = req.body

    if (!name) {
      return res.status(400).json({ mensagem: 'Informe o nome do setor' })
    }

    const { data, error } = await supabase
      .from('sector')
      .update({ name })
      .eq('id', id)
      .select('*')

    if (error) {
        console.log(error)
      return res.status(400).json({ mensagem: 'Erro ao atualizar setor', erro: error })
    }

    res.status(200).json({ mensagem: 'setor atualizado com sucesso', sector: data[0] })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Deletar sector
route.delete('/deletarSetor/:id', async (req, res) => {
  try {
    const { id } = req.params

    const { error } = await supabase
    .from('sector')
    .delete()
    .eq('id', id)

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao deletar sector', erro: error })
    }

    res.status(200).json({ mensagem: 'sector deletado com sucesso' })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// adicionar feriados
route.post('/adicionarFeriados_master', async (req, res) => {
  try {
    const feriados = req.body // pode ser um objeto ou array

    if (!feriados || feriados.length === 0) {
      return res.status(400).json({ mensagem: 'Envie pelo menos um feriado' })
    }

    const lista = Array.isArray(feriados) ? feriados : [feriados]

    const invalidos = lista.filter(f => !f.dia_feriado || !f.nome_feriado)
    if (invalidos.length > 0) {
      return res
        .status(400)
        .json({ mensagem: 'Todos os feriados devem conter dia_feriado e nome_feriado' })
    }

    const { data, error } = await supabase.from('feriado').insert(lista).select()

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao adicionar feriados', erro: error })
    }

    res.status(201).json({
      mensagem: 'Feriados adicionados com sucesso',
      feriados: data
    })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Listar Feriados

route.get('/listarFeriados_master', async (req, res) => {
  try {
    const { data, error } = await supabase
    .from('holiday').select('*')

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao listar feriados', erro: error })
    }
    res.status(200).json({ feriados: data })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Deletar Feriado

route.delete('/deletarFeriado_master/:id_feriado', async (req, res) => {
  try {
    const { id_feriado } = req.params

    const { error } = await supabase.from('feriado').delete().eq('id_feriado', id_feriado)

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao deletar feriado', erro: error })
    }

    res.status(200).json({ mensagem: 'Feriado deletado com sucesso' })
  } catch (error) {
    res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

route.post('/cadastrarDiaEspecifico_master', async (req, res) => {
  try {

    const obrigatorios = ['registration', 'nome_diae', 'data_diae', 'descricao_diae']
    const campoFaltando = validarCampos(obrigatorios, req.body)

    if (campoFaltando) {
      return res.status(400).json({
        mensagem: `Preencha o campo obrigatório: ${campoFaltando}`
      })
    }

    const { registration, nome_diae, data_diae, descricao_diae } = req.body

    // verifica se já existe um dia específico cadastrado na mesma data para o mesmo funcionário
    const { data: diaExistente, error: errorCheck } = await supabase
      .from('occasion')
      .select('*')
      .eq('registration', registration)
      .eq('data_diae', data_diae)
      .maybeSingle()

    if (errorCheck) {
      return res.status(400).json({
        mensagem: 'Erro ao verificar existência de dia específico',
        erro: errorCheck.message
      })
    }

    if (diaExistente) {
      return res.status(409).json({
        mensagem: 'Já existe um dia específico cadastrado para este funcionário nesta data'
      })
    }

    // insere o novo dia específico
    const { data: diaEspecifico, error } = await supabase
      .from('occasion')
      .insert([{
        registration,
        nome_diae,
        data_diae,
        descricao_diae
      }])
      .select('*')
      .single()

    if (error) {
      return res.status(400).json({
        mensagem: 'Erro ao inserir dia específico',
        erro: error.message
      })
    }

    // notificar funcionário sobre o novo dia específico
    await criarNotificacao({
      registration,
      tipo_notificacao: 'Novo Dia Específico',
      mensagem: `Um novo dia específico foi adicionado: ${nome_diae} (${data_diae}). Verifique os detalhes no sistema.`
    })

    return res.status(201).json({
      mensagem: 'Dia específico criado com sucesso e notificação enviada',
      diaEspecifico
    })

  } catch (err) {
    return res.status(500).json({
      mensagem: 'Erro no servidor',
      erro: err.message
    })
  }
})

export default route
