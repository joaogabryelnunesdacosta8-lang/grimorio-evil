import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {SUPABASE_URL,SUPABASE_KEY} from './config.js';

const $ = id => document.getElementById(id);
const msg = t => $('status').textContent = t;

const cats = [
    'Itens','Consumíveis','Monstros','Mapas',
    'Habilidades','Dicas','Missões','Chefes','Atualizações'
];

const classes = ['Todos','Mago','Assassino','Guerreiro'];

let db, user, admin = false, rows = [];
let filter = 'Todos', classFilter = 'Todos';
let editing = null, recovering = false;

const redirect = location.origin + location.pathname;

function fail(e) {
    msg(e.message || String(e));
}

function action(id, fn, event = 'click') {
    $(id).addEventListener(event, async e => {
        e.preventDefault();
        try {
            await fn();
        } catch (err) {
            fail(err);
        }
    });
}

function check(r) {
    if (r.error) throw r.error;
    return r.data;
}

for (const c of cats) {
    const o = document.createElement('option');
    o.textContent = c;
    $('category').append(o);
}

for (const c of ['Todos', ...cats]) {
    const b = document.createElement('button');
    b.textContent = c;
    b.onclick = () => {
        filter = c;
        classFilter = 'Todos';
        render();
    };
    $('categories').append(b);
}

for (const c of classes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.class = c;
    const icons = {
    Mago: './mago.png',
    Assassino: './assassino.png',
    Guerreiro: './guerreiro.png'
};

if (icons[c]) {
    const img = document.createElement('img');
    img.src = icons[c];
    img.alt = '';
    img.className = 'class-icon';
    b.appendChild(img);
}

const label = document.createElement('span');
label.textContent = c;
b.appendChild(label);
    b.onclick = () => {
        classFilter = c;
        render();
    };
    $('classFilters').append(b);
}

const classInputs = [
    ...document.querySelectorAll('input[name="classes"]')
];

for (const input of classInputs) {
    input.addEventListener('change', () => {
        if (input.value === 'Todos' && input.checked) {
            for (const other of classInputs) {
                if (other !== input) other.checked = false;
            }
        } else if (input.checked) {
            classInputs.find(x => x.value === 'Todos').checked = false;
        }
        if (!classInputs.some(x => x.checked)) {
            classInputs.find(x => x.value === 'Todos').checked = true;
        }
    });
}

function getClasses(r) {
    return Array.isArray(r.classes) && r.classes.length
        ? r.classes : ['Todos'];
}

function clear() {
    editing = null;
    $('editor').reset();
}

function render() {
    for (const b of $('categories').children) {
        b.classList.toggle('active', b.textContent === filter);
    }

    for (const b of $('classFilters').children) {
        const active = b.dataset.class === classFilter;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
    }

    const q = $('search').value.toLocaleLowerCase('pt-BR');

    $('entries').replaceChildren();

    const filtered = rows.filter(r => {
        const rc = getClasses(r);

        return (
            (filter === 'Todos' || r.category === filter) &&
            (classFilter === 'Todos' ||
             rc.includes('Todos') ||
             rc.includes(classFilter)) &&
            (r.title + ' ' + r.content)
                .toLocaleLowerCase('pt-BR').includes(q)
        );
    });

    for (const r of filtered) {
        const a = document.createElement('article');

        const h = document.createElement('h3');
        h.textContent = r.title;
        a.append(h);

        const s = document.createElement('small');
        s.textContent = r.category;
        a.append(s);

        const tag = document.createElement('p');
        tag.className = 'class-tag';
        tag.textContent = getClasses(r).includes('Todos')
            ? 'Todas as classes'
            : getClasses(r).join(' • ');
        a.append(tag);

        if (r.image_path) {
            const im = document.createElement('img');
            im.alt = r.title;

            db.storage.from('images')
                .createSignedUrl(r.image_path, 3600)
                .then(x => {
                    if (x.data) im.src = x.data.signedUrl;
                });

            a.append(im);
        }

        const p = document.createElement('p');
        p.textContent = r.content;
        a.append(p);

        if (admin) {
            const e = document.createElement('button');
            e.textContent = 'Editar';

            e.onclick = () => {
                clear();
                editing = r;

                $('title').value = r.title;
                $('category').value = r.category;
                $('content').value = r.content;

                const rc = getClasses(r);

                for (const input of classInputs) {
                    input.checked = rc.includes(input.value);
                }

                $('admin').scrollIntoView({
                    behavior: 'smooth'
                });
            };

            const d = document.createElement('button');
            d.textContent = 'Excluir';

            d.onclick = async () => {
                if (!confirm('Excluir este conteúdo?')) return;

                try {
                    check(await db.from('entries')
                        .delete().eq('id', r.id));

                    if (r.image_path) {
                        await db.storage.from('images')
                            .remove([r.image_path]);
                    }

                    await load();
                } catch (e) {
                    fail(e);
                }
            };

            a.append(e, d);
        }

        $('entries').append(a);
    }

    if (!$('entries').children.length) {
        $('entries').textContent = 'Nenhum conteúdo encontrado.';
    }
}

async function load() {
    rows = check(await db.from('entries')
        .select('*')
        .order('created_at', {ascending: false}));

    render();
}

async function session(s) {
    user = s?.user;
    admin = false;

    $('auth').hidden = !!user;
    $('logout').hidden = !user;
    $('library').hidden = !user || recovering;
    $('recovery').hidden = !recovering;
    $('admin').hidden = true;
    $('identity').textContent = user ? 'Conta conectada' : '';

    if (!user) {
        rows = [];
        clear();
        $('entries').replaceChildren();
        return;
    }

    if (recovering) return;

    admin = check(await db.rpc('is_admin'));
    $('admin').hidden = !admin;

    await load();
}

if (!SUPABASE_URL.startsWith('https://')) {
    msg('Site ainda não conectado ao banco de dados.');

    for (const b of $('auth').querySelectorAll('button')) {
        b.disabled = true;
    }
} else {
    db = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });

    db.auth.onAuthStateChange((event, s) => {
        if (event === 'PASSWORD_RECOVERY') recovering = true;
        setTimeout(() => session(s).catch(fail), 0);
    });

    db.auth.getSession().then(({data, error}) => {
        if (error) {
            fail(error);
            return;
        }
        session(data.session).catch(fail);
    }).catch(fail);

    const params = new URLSearchParams(
        location.hash.slice(1) || location.search
    );

    if (params.has('error_description')) {
        msg(params.get('error_description'));
    }

    action('google', async () => {
        check(await db.auth.signInWithOAuth({
            provider: 'google',
            options: {redirectTo: redirect}
        }));
    });

    action('login', async () => {
        check(await db.auth.signInWithPassword({
            email: $('email').value,
            password: $('password').value
        }));
        msg('Sessão iniciada.');
    }, 'submit');

    action('signup', async () => {
        check(await db.auth.signUp({
            email: $('email').value,
            password: $('password').value,
            options: {emailRedirectTo: redirect}
        }));
        msg('Confira seu e-mail para confirmar o cadastro.');
    });

    action('reset', async () => {
        check(await db.auth.resetPasswordForEmail(
            $('email').value,
            {redirectTo: redirect}
        ));
        msg('Confira seu e-mail.');
    });

    action('newpass', async () => {
        check(await db.auth.updateUser({
            password: $('newpassword').value
        }));
        recovering = false;
        await session((await db.auth.getSession()).data.session);
        msg('Senha atualizada.');
    }, 'submit');

    action('logout', async () => {
        recovering = false;
        check(await db.auth.signOut());
        msg('Sessão encerrada.');
    });

    action('cancel', clear);

    $('search').oninput = render;

    action('editor', async () => {
        if (!admin) return;

        let path = editing?.image_path || null;
        const old = path;
        const f = $('picture').files[0];

        if (f) {
            if (
                !['image/png','image/jpeg','image/webp'].includes(f.type) ||
                f.size > 5 * 1024 * 1024
            ) {
                throw Error('Use PNG, JPEG ou WebP de até 5 MB.');
            }

            path = crypto.randomUUID();

            check(await db.storage.from('images').upload(
                path, f, {contentType: f.type}
            ));
        }

        let selected = classInputs
            .filter(x => x.checked)
            .map(x => x.value);

        if (!selected.length || selected.includes('Todos')) {
            selected = ['Todos'];
        }

        const data = {
            title: $('title').value,
            category: $('category').value,
            content: $('content').value,
            image_path: path,
            classes: selected
        };

        try {
            check(await (
                editing
                    ? db.from('entries').update(data).eq('id', editing.id)
                    : db.from('entries').insert(data)
            ));
        } catch (e) {
            if (f) {
                await db.storage.from('images').remove([path]);
            }
            throw e;
        }

        if (f && old) {
            await db.storage.from('images').remove([old]);
        }

        clear();
        await load();
        msg('Conteúdo salvo.');
    }, 'submit');
}
