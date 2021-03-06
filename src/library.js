/*
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const { GObject, Gio, GLib, Gtk, Gdk, GdkPixbuf, WebKit2, Pango } = imports.gi
const { debug, Storage, Obj, base64ToPixbuf, markupEscape, shuffle } = imports.utils
const { PropertiesBox } = imports.properties
const { Window } = imports.window
const { uriStore, bookList } = imports.uriStore
const { HdyHeaderBar, HdyViewSwitcher, HdyColumn } = imports.handy

const BookBoxChild =  GObject.registerClass({
    GTypeName: 'FoliateBookBoxChild',
    Template: 'resource:///com/github/johnfactotum/Foliate/ui/bookBoxChild.ui',
    InternalChildren: [
        'image', 'title'
    ],
    Properties: {
        entry: GObject.ParamSpec.object('entry', 'entry', 'entry',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, Obj.$gtype),
    }
}, class BookBoxChild extends Gtk.FlowBoxChild {
    _init(params) {
        super._init(params)
        const { title } = this.entry.value
        this._title.label = title
    }
    loadCover(pixbuf) {
        const width = 120
        const ratio = width / pixbuf.get_width()
        if (ratio < 1) {
            const height = parseInt(pixbuf.get_height() * ratio, 10)
            this._image.set_from_pixbuf(pixbuf
                .scale_simple(width, height, GdkPixbuf.InterpType.BILINEAR))
        } else this._image.set_from_pixbuf(pixbuf)
        this._image.get_style_context().add_class('foliate-book-image')
        this.width_request = width
    }
    get image() {
        return this._image
    }
})

const makeAcquisitionButton = (links, onActivate) => {
    const rel = links[0].rel.split('/').pop()
    let label = _('Download')
    switch (rel) {
        case 'buy': label = _('Buy'); break
        case 'open-access': label = _('Free'); break
        case 'sample': label = _('Sample'); break
        case 'borrow': label = _('Borrow'); break
        case 'subscribe': label = _('Subscribe'); break
    }
    if (links.length === 1) {
        const button = new Gtk.Button({ visible: true, label })
        button.connect('clicked', () => onActivate(links[0]))
        return button
    } else {
        const popover = new Gtk.PopoverMenu()
        const box = new Gtk.Box({
            visible: true,
            orientation: Gtk.Orientation.VERTICAL,
            margin: 10
        })
        popover.add(box)
        const button = new Gtk.MenuButton({ popover })
        const buttonBox = new Gtk.Box()
        const icon = new Gtk.Image({ icon_name: 'pan-down-symbolic' })
        buttonBox.pack_start(new Gtk.Label({ label }), true, true, 0)
        buttonBox.pack_end(icon, false, true, 0)
        button.add(buttonBox)
        button.show_all()
        links.forEach(link => {
            const mimetype = link.type
            const text = link.title || Gio.content_type_get_description(mimetype)
            const menuItem = new Gtk.ModelButton({
                visible: true,
                text,
                tooltip_text: mimetype
            })
            menuItem.connect('clicked', () => onActivate(link))
            box.pack_start(menuItem, false, true, 0)
        })
        return button
    }
}

const OpdsEntryBox =  GObject.registerClass({
    GTypeName: 'FoliateOpdsEntryBox',
    Properties: {
        entry: GObject.ParamSpec.object('entry', 'entry', 'entry',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, Obj.$gtype),
    }
}, class OpdsEntryBox extends Gtk.Box {
    _init(params) {
        super._init(params)
        this.orientation = Gtk.Orientation.VERTICAL
        const {
            title, summary, publisher, language, identifier, rights,
            published, updated, issued,
            authors = [],
            links = [],
        } = this.entry.value

        const scrolled = new Gtk.ScrolledWindow({
            visible: true
        })
        const propertiesBox = new PropertiesBox({
            visible: true,
            border_width: 12
        }, {
            title, publisher, language, identifier, rights,
            creator: authors.map(x => x.name).join(', '),
            description: summary,
            pubdate: issued || published,
            modified_date: updated
        }, null)
        scrolled.add(propertiesBox)
        this.pack_start(scrolled, true, true, 0)

        const acquisitionBox = new Gtk.Box({
            visible: true,
            spacing: 6,
            border_width: 12,
            orientation: Gtk.Orientation.VERTICAL
        })
        this.pack_end(acquisitionBox, false, true, 0)

        const map = new Map()
        links.filter(x => x.rel.startsWith('http://opds-spec.org/acquisition'))
            .forEach(x => {
                if (!map.has(x.rel)) map.set(x.rel, [x])
                else map.get(x.rel).push(x)
            })
        Array.from(map.values()).forEach((links, i) => {
            const button = makeAcquisitionButton(links, ({ type, href }) => {
                // open in a browser
                Gtk.show_uri_on_window(null, href, Gdk.CURRENT_TIME)
                //Gio.AppInfo.launch_default_for_uri(href, null)

                // or, open with app directly
                // const appInfo = Gio.AppInfo.get_default_for_type(type, true)
                // appInfo.launch_uris([href], null)
            })
            acquisitionBox.pack_start(button, false, true, 0)
            if (i === 0) {
                button.get_style_context().add_class('suggested-action')
                button.grab_focus()
            }
        })
        if (map.size <= 3) {
            acquisitionBox.orientation = Gtk.Orientation.HORIZONTAL
            acquisitionBox.homogeneous = true
        }
    }
})

const BookListRow =  GObject.registerClass({
    GTypeName: 'FoliateBookListRow',
    Template: 'resource:///com/github/johnfactotum/Foliate/ui/bookListRow.ui',
    InternalChildren: [
        'title', 'creator',
        'progressGrid', 'progressBar', 'progressLabel',
        'remove'
    ],
    Properties: {
        book: GObject.ParamSpec.object('book', 'book', 'book',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, Obj.$gtype),
    }
}, class BookListRow extends Gtk.ListBoxRow {
    _init(params) {
        super._init(params)
        const { progress, metadata: { title, creator } } = this.book.value
        this._title.label = title || ''
        this._creator.label = creator || ''
        if (progress && progress[1]) {
            const fraction = (progress[0] + 1) / (progress[1] + 1)
            this._progressBar.fraction = fraction
            this._progressLabel.label = Math.round(fraction * 100) + '%'
            // this._progressLabel.label = `${(progress[0] + 1)} / ${(progress[1] + 1)}`
            const bookSize = Math.min((progress[1] + 1) / 1500, 0.8)
            const steps = 20
            const span = Math.round(bookSize * steps) + 1
            this._progressGrid.child_set_property(this._progressBar, 'width', span)
            this._progressGrid.child_set_property(this._progressLabel, 'width', steps - span)
            this._progressGrid.child_set_property(this._progressLabel, 'left-attach', span)
        } else this._progressGrid.hide()

        this._remove.connect('clicked', this.remove.bind(this))
    }
    remove() {
        const window = this.get_toplevel()
        const msg = new Gtk.MessageDialog({
            text: _('Are you sure you want to remove this book?'),
            secondary_text: _('Reading progress, annotations, and bookmarks will be permanently lost.'),
            message_type: Gtk.MessageType.WARNING,
            modal: true,
            transient_for: window
        })
        msg.add_button(_('Cancel'), Gtk.ResponseType.CANCEL)
        msg.add_button(_('Remove'), Gtk.ResponseType.ACCEPT)
        msg.set_default_response(Gtk.ResponseType.CANCEL)
        msg.get_widget_for_response(Gtk.ResponseType.ACCEPT)
            .get_style_context().add_class('destructive-action')
        const res = msg.run()
        if (res === Gtk.ResponseType.ACCEPT) {
            const id = this.book.value.metadata.identifier
            bookList.remove(id)
            uriStore.delete(id)
            Gio.File.new_for_path(Storage.getPath('data', id)).delete(null)
            Gio.File.new_for_path(Storage.getPath('cache', id)).delete(null)
        }
        msg.close()
    }
})


const LoadMoreRow =  GObject.registerClass({
    GTypeName: 'FoliateLoadMoreRow'
}, class LoadMoreRow extends Gtk.ListBoxRow {
    _init(params) {
        super._init(params)
        this.add(new Gtk.Image({
            visible: true,
            icon_name: 'view-more-symbolic',
            margin: 12
        }))
    }
})

var BookListBox = GObject.registerClass({
    GTypeName: 'FoliateBookListBox'
}, class BookListBox extends Gtk.ListBox {
    _init(params) {
        super._init(params)
        this.set_header_func((row) => {
            if (row.get_index()) row.set_header(new Gtk.Separator())
        })
        const lmr = new LoadMoreRow()
        this.bind_model(bookList.list, book => {
            if (book.value === 'load-more') return lmr
            else return new BookListRow({ book })
        })
        bookList.load()
        bookList.next()

        this.connect('row-activated', (box, row) => {
            if (row === lmr) {
                bookList.next()
                return
            }
            const id = row.book.value.metadata.identifier
            const uri = uriStore.get(id)
            if (!uri) {
                const window = this.get_toplevel()
                const msg = new Gtk.MessageDialog({
                    text: _('File location unkown'),
                    secondary_text: _('Choose the location of this file to open it.'),
                    message_type: Gtk.MessageType.QUESTION,
                    buttons: Gtk.ButtonsType.OK_CANCEL,
                    modal: true,
                    transient_for: window
                })
                msg.set_default_response(Gtk.ResponseType.OK)
                const res = msg.run()
                if (res === Gtk.ResponseType.OK)
                    window.application.lookup_action('open').activate(null)
                msg.close()
                return
            }
            const file = Gio.File.new_for_uri(uri)
            this.get_toplevel().open(file)
        })

        const cssProvider = new Gtk.CssProvider()
        cssProvider.load_from_data(`progress, trough { min-width: 1px; }`)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(),
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    }
})

const htmlPath = pkg.pkgdatadir + '/assets/opds.html'
class OpdsClient {
    constructor() {
        this._promises = new Map()

        this._webView = new WebKit2.WebView({
            settings: new WebKit2.Settings({
                enable_write_console_messages_to_stdout: true,
                allow_file_access_from_file_urls: true,
                allow_universal_access_from_file_urls: true,
                enable_developer_extras: true
            })
        })
        const contentManager = this._webView.get_user_content_manager()
        contentManager.connect('script-message-received::action', (_, jsResult) => {
            const data = jsResult.get_js_value().to_string()
            const { type, payload, token } = JSON.parse(data)
            switch (type) {
                case 'ready':
                    this._promises.get('ready').resolve()
                    break
                case 'error':
                    this._promises.get(token).reject(new Error(payload))
                    break
                case 'entry':
                case 'feed': {
                    this._promises.get(token).resolve(payload)
                    break
                }
                case 'image': {
                    const pixbuf = base64ToPixbuf(payload)
                    this._promises.get(token).resolve(pixbuf)
                    break
                }
            }
        })
        contentManager.register_script_message_handler('action')
        this._webView.load_uri(GLib.filename_to_uri(htmlPath, null))
        this._webView.connect('destroy', () => {
            Array.from(this._promises.values()).forEach(({ reject }) =>
                reject(new Error('OPDS: WebView destroyed')))
        })
    }
    _run(script) {
        this._webView.run_javascript(script, null, () => {})
    }
    init() {
        return this._makePromise('ready')
    }
    get(uri) {
        debug('OPDS: getting ' + uri)
        const token = this._makeToken()
        this._run(`getFeed(
            decodeURI("${encodeURI(uri)}"),
            decodeURI("${encodeURI(token)}"))`)
        return this._makePromise(token)
    }
    getImage(uri) {
        const token = this._makeToken()
        this._run(`getImage(
            decodeURI("${encodeURI(uri)}"),
            decodeURI("${encodeURI(token)}"))`)
        return this._makePromise(token)
    }
    _makePromise(token) {
        return new Promise((resolve, reject) =>
            this._promises.set(token, {
                resolve: arg => {
                    resolve(arg)
                    this._promises.delete(token)
                },
                reject: arg => {
                    reject(arg)
                    this._promises.delete(token)
                }
            }))
    }
    _makeToken() {
        return Math.random() + '' + new Date().getTime()
    }
    close() {
        this._webView.destroy()
    }
}

const OpdsScrolledBox =  GObject.registerClass({
    GTypeName: 'FoliateOpdsScrolledBox',
    Properties: {
        'max-entries':
            GObject.ParamSpec.int('max-entries', 'max-entries', 'max-entries',
                GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT, 1, 2147483647, 2147483647),
        uri: GObject.ParamSpec.string('uri', 'uri', 'uri',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, ''),
    }
}, class OpdsScrolledBox extends Gtk.ScrolledWindow {
    _init(params, sort) {
        super._init(params)
        const { max_entries, uri } = this
        const loadbox = new LoadBox({ visible: true }, () => {
            const box = new OpdsAcquisitionBox({
                visible: true,
                max_entries, uri,
                max_children_per_line: max_entries,
                min_children_per_line: max_entries,
            }, sort)
            box.connect('image-draw', () => {
                this.min_content_height = box.get_allocation().height
            })
            return box
        })
        this.propagate_natural_height = true
        this.add(loadbox)
    }
})

const LoadBox = GObject.registerClass({
    GTypeName: 'FoliateLoadBox'
}, class LoadBox extends Gtk.Stack {
    _init(params, load) {
        super._init(params)
        const spinner = new Gtk.Spinner({
            visible: true,
            active: true
        })
        this.add_named(spinner, 'loading')
        const error = new Gtk.Label({
            visible: true,
            label: _('Unable to load OPDS feed')
        })
        this.add_named(error, 'error')
        let loaded
        this.connect('realize', () => {
            if (loaded) return
            const widget = load()
            this.add_named(widget, 'loaded')
            widget.connect('loaded', () => {
                this.visible_child_name = 'loaded'
            })
            widget.connect('error', () => {
                this.visible_child_name = 'error'
            })
            loaded = true
        })
    }
})

const OpdsFeed = GObject.registerClass({
    GTypeName: 'FoliateOpdsFeed',
    Properties: {
        uri: GObject.ParamSpec.string('uri', 'uri', 'uri',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, ''),
    },
    Signals: {
        'loaded': { flags: GObject.SignalFlags.RUN_FIRST },
        'error': { flags: GObject.SignalFlags.RUN_FIRST },
    }
}, class OpdsFeed extends Gtk.Bin {
    _init(params) {
        super._init(params)
        if (this.uri) {
            const client = new OpdsClient()
            client.init()
                .then(() => client.get(this.uri))
                .then(feed => {
                    this.feed = feed
                    this.emit('loaded')
                })
                .catch(e => {
                    logError(e)
                    this.emit('error')
                })
                .finally(() => client.close())
        }
    }
})

const OpdsAcquisitionBox = GObject.registerClass({
    GTypeName: 'FoliateOpdsAcquisitionBox',
    Properties: {
        'max-entries':
            GObject.ParamSpec.int('max-entries', 'max-entries', 'max-entries',
                GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT, 0, 2147483647, 0),
        uri: GObject.ParamSpec.string('uri', 'uri', 'uri',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, ''),
    },
    Signals: {
        'loaded': { flags: GObject.SignalFlags.RUN_FIRST },
        'error': { flags: GObject.SignalFlags.RUN_FIRST },
        'image-draw': { flags: GObject.SignalFlags.RUN_FIRST }
    }
}, class OpdsAcquisitionBox extends Gtk.FlowBox {
    _init(params, sort) {
        super._init(Object.assign({
            valign: Gtk.Align.START,
            row_spacing: 12,
            column_spacing: 12,
            homogeneous: true,
            activate_on_single_click: true,
            selection_mode: Gtk.SelectionMode.NONE
        }, params))
        this.sort = sort

        this.connect('child-activated', (flowbox, child) => {
            const popover = new Gtk.Popover({
                relative_to: child.image,
                width_request: 320,
                height_request: 320
            })
            const entryBox = new OpdsEntryBox({
                visible: true,
                entry: child.entry,
            })
            popover.add(entryBox)
            popover.popup()
        })
        if (this.uri) {
            const client = new OpdsClient()
            client.init()
                .then(() => client.get(this.uri))
                .then(({ entries }) => this.load(entries))
                .catch(this.error.bind(this))
                .finally(() => client.close())
        }
    }
    async load(entries) {
        this.emit('loaded')
        let loadCount = 0
        const client = new OpdsClient()
        await client.init()
        const list = new Gio.ListStore()
        if (this.sort) entries = this.sort(entries.slice(0))
        if (this.max_entries) entries = entries.slice(0, this.max_entries)
        entries.forEach(entry => list.append(new Obj(entry)))
        this.bind_model(list, entry => {
            const child = new BookBoxChild({ entry })
            const thumbnail = entry.value.links
                .find(x => x.rel === 'http://opds-spec.org/image/thumbnail')
            child.image.connect('draw', () => this.emit('image-draw'))
            child.image.connect('realize', () => {
                if (thumbnail)
                    client.getImage(thumbnail.href)
                        .then(pixbuf => child.loadCover(pixbuf))
                        .finally(() => {
                            loadCount++
                            if (loadCount === entries.length) client.close()
                        })
            })
            return child
        })
    }
    error(e) {
        logError(e)
        this.emit('error')
    }
})

const NavigationRow =  GObject.registerClass({
    GTypeName: 'FoliateNavigationRow',
    Template: 'resource:///com/github/johnfactotum/Foliate/ui/navigationRow.ui',
    InternalChildren: ['title', 'content', 'count', 'select'],
    Properties: {
        entry: GObject.ParamSpec.object('entry', 'entry', 'entry',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, Obj.$gtype),
    }
}, class NavigationRow extends Gtk.ListBoxRow {
    _init(params) {
        super._init(params)
        const { title, content, links } = this.entry.value
        this._title.label = title || ''
        if (content) this._content.label = content
        else this._content.hide()

        const count = links[0].count
        if (typeof count !== 'undefined') this._count.label = String(count)
        else this._count.hide()

        const activeFacet = links[0].activeFacet
        if (activeFacet) this._select.show()
    }
})

const OpdsNavigationBox = GObject.registerClass({
    GTypeName: 'FoliateOpdsNavigationBox',
    Properties: {
        uri: GObject.ParamSpec.string('uri', 'uri', 'uri',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, ''),
        facet: GObject.ParamSpec.boolean('facet', 'facet', 'facet',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, false),
    },
    Signals: {
        'loaded': { flags: GObject.SignalFlags.RUN_FIRST },
        'error': { flags: GObject.SignalFlags.RUN_FIRST },
        'link-activated': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING]
        },
    }
}, class OpdsNavigationBox extends Gtk.ListBox {
    _init(params) {
        super._init(params)
        this.get_style_context().add_class('frame')

        this._map = new Map()

        this.connect('row-activated', (listbox, row) => {
            const entry = this._map.get(row).value
            const { href, type } = entry.links[0]
            this.emit('link-activated', href, type)
        })

        if (this.facet) {
            let lastGroup
            this.set_header_func(row => {
                const index = row.get_index()
                const entry = this._map.get(row).value
                const group = entry.links[0].facetGroup
                if (group && group !== lastGroup) {
                    const box = new Gtk.Box({
                        orientation: Gtk.Orientation.VERTICAL,
                    })
                    if (index) box.pack_start(new Gtk.Separator(), false, true, 0)
                    const label = new Gtk.Label({
                        label: `<b>${markupEscape(group)}</b>`,
                        margin_top: index ? 18 : 6,
                        margin_bottom: 6,
                        margin_start: 6,
                        margin_end: 6,
                        use_markup: true,
                        justify: Gtk.Justification.CENTER,
                        ellipsize: Pango.EllipsizeMode.END,
                    })
                    label.get_style_context().add_class('dim-label')
                    box.pack_start(label, false, true, 0)
                    box.pack_start(new Gtk.Separator(), false, true, 0)
                    box.show_all()
                    row.set_header(box)
                } else if (index) row.set_header(new Gtk.Separator())
                lastGroup = group
            })
        } else this.set_header_func(row => {
            if (row.get_index()) row.set_header(new Gtk.Separator())
        })

        if (this.uri) {
            const client = new OpdsClient()
            client.init()
                .then(() => client.get(this.uri))
                .then(({ entries }) => this.load(entries))
                .catch(this.error.bind(this))
                .finally(() => client.close())
        }
    }
    load(entries) {
        this.emit('loaded')
        const list = new Gio.ListStore()
        entries.forEach(entry => list.append(new Obj(entry)))
        this.bind_model(list, entry => {
            const row = new NavigationRow({ entry })
            this._map.set(row, entry)
            return row
        })
    }
    error(e) {
        logError(e)
        this.emit('error')
    }
})

const isAcquisitionFeed = feed => feed.entries && feed.entries.some(entry =>
    entry.links && entry.links.some(({ rel }) =>
        rel && rel.startsWith('http://opds-spec.org/acquisition')))

const OpdsBox = GObject.registerClass({
    GTypeName: 'FoliateOpdsBox',
    Properties: {
        uri: GObject.ParamSpec.string('uri', 'uri', 'uri',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, ''),
    },
    Signals: {
        'loaded': { flags: GObject.SignalFlags.RUN_FIRST },
        'error': { flags: GObject.SignalFlags.RUN_FIRST },
    }
}, class OpdsBox extends Gtk.Bin {
    _init(params) {
        super._init(params)
        if (this.uri) {
            const client = new OpdsClient()
            client.init()
                .then(() => client.get(this.uri))
                .then(this.load.bind(this))
                .catch(this.error.bind(this))
                .finally(() => client.close())
        }
    }
    load(feed) {
        this.feed = feed
        const isAcquisition = isAcquisitionFeed(feed)
        const opdsbox = isAcquisition
            ? new OpdsAcquisitionBox({ visible: true, margin: 18 })
            : new OpdsNavigationBox({ visible: true, margin: 18 })
        opdsbox.load(feed.entries)
        this.add(opdsbox)
        this.emit('loaded')
    }
    error(e) {
        logError(e)
        this.emit('error')
    }
})

var LibraryWindow =  GObject.registerClass({
    GTypeName: 'FoliateLibraryWindow',
    Template: 'resource:///com/github/johnfactotum/Foliate/ui/libraryWindow.ui',
    InternalChildren: [
        'stack', 'catalogColumn', 'startButtonStack'
    ],
}, class LibraryWindow extends Gtk.ApplicationWindow {
    _init(params) {
        super._init(params)
        this.show_menubar = false
        this.title = _('Foliate')

        this._loadCatalogs().catch(logError)
    }
    open(file) {
        new Window({ application: this.application, file}).present()
        // this.close()
    }
    async _loadCatalogs() {
        const box = new Gtk.Box({
            visible: true,
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin: 12
        })
        const arr = [
            {
                title: 'Standard Ebooks',
                uri: 'https://standardebooks.org/opds/all',
                categories: [
                    { term: 'Science fiction' },
                    { term: 'Detective and mystery stories' },
                    { term: 'Domestic fiction' },
                ]
            },
            // {
            //     title: 'Feedbooks',
            //     uri: 'https://catalog.feedbooks.com/publicdomain/browse/en/homepage_selection.atom'
            // }
        ]

        for (const { title, uri, categories } of arr) {
            const loadbox = new LoadBox({ visible: true }, () => {
                const widget = new OpdsFeed({ visible: true, uri })

                const box = new Gtk.Box({
                    visible: true,
                    orientation: Gtk.Orientation.VERTICAL,
                    spacing: 12,
                    margin: 12
                })
                box.pack_start(new Gtk.Label({
                    visible: true,
                    xalign: 0,
                    wrap: true,
                    useMarkup: true,
                    label: `<b><big>${markupEscape(title)}</big></b>`
                }), false, true, 0)
                widget.add(box)
                widget.connect('loaded', () => {
                    const feed = widget.feed
                    const items = categories.map(({ term }) => [term,
                        feed.entries.filter(entry => entry.categories && entry.categories
                            .some(category => category.term && category.term.includes(term)))])

                    for (const [subtitle, entries] of items) {
                        const x = new OpdsAcquisitionBox({
                            visible: true,
                            max_entries: 5,
                        }, shuffle)
                        x.load(entries)

                        box.pack_start(new Gtk.Label({
                            visible: true,
                            xalign: 0,
                            wrap: true,
                            useMarkup: true,
                            label: `<b>${markupEscape(subtitle)}</b>`
                        }), false, true, 0)
                        box.pack_start(x, false, true, 0)
                    }
                })
                return widget
            })
            box.pack_start(loadbox, false, true, 0)
        }
        this._catalogColumn.add(box)
    }
})

var OpdsWindow =  GObject.registerClass({
    GTypeName: 'FoliateOpdsWindow',
    Template: 'resource:///com/github/johnfactotum/Foliate/ui/opdsWindow.ui',
    InternalChildren: ['mainBox', 'backButton', 'homeButton'],
}, class OpdsWindow extends Gtk.ApplicationWindow {
    _init(params) {
        super._init(params)
        this.show_menubar = false
        this.title = _('Foliate')

        this._history = []

        this.actionGroup = new Gio.SimpleActionGroup()
        const actions = {
            'back': () => this._goBack(),
            'home': () => this._goHome()
        }
        Object.keys(actions).forEach(name => {
            const action = new Gio.SimpleAction({ name })
            action.connect('activate', actions[name])
            this.actionGroup.add_action(action)
        })
        this.insert_action_group('opds', this.actionGroup)
        const overlay = Gtk.Builder.new_from_resource(
            '/com/github/johnfactotum/Foliate/ui/shortcutsWindow.ui')
            .get_object('shortcutsWindow')
        this.set_help_overlay(overlay)

        this.actionGroup.lookup_action('back').bind_property('enabled',
            this._backButton, 'visible', GObject.BindingFlags.DEFAULT)
        this.actionGroup.lookup_action('home').bind_property('enabled',
            this._homeButton, 'visible', GObject.BindingFlags.DEFAULT)
        this._updateBack()
        this._home = null
    }
    _updateBack() {
        this.actionGroup.lookup_action('back').enabled = this._history.length
    }
    _goBack() {
        if (!this._history.length) return
        this._loadOpds(this._history.pop())
        this._updateBack()
    }
    _pushHistory(x) {
        this._history.push(x)
        this._updateBack()
    }
    _clearHistory() {
        this._history = []
        this._updateBack()
    }
    get _home() {
        return this.__home
    }
    set _home(home) {
        this.__home = home
        this.actionGroup.lookup_action('home').enabled = home && home !== this._uri
    }
    _goHome() {
        if (!this._home) return
        this._pushHistory(this._uri)
        this._loadOpds(this._home)
    }
    loadOpds(uri) {
        this._loadOpds(uri).catch(e => logError(e))
    }
    async _loadOpds(uri) {
        this._uri = uri
        if (this._opdsWidget) this._opdsWidget.destroy()

        const nb = new Gtk.Notebook({
            visible: true,
            scrollable: true,
            show_border: false
        })
        this._opdsWidget = nb
        this._mainBox.pack_start(nb, true, true, 0)

        const makePage = (uri, title, callback) => {
            const label = new Gtk.Label({
                visible: true,
                ellipsize: Pango.EllipsizeMode.END,
                label: title || _('Loading…'),
                tooltip_text: title || null
            })

            const box = new HdyColumn({
                visible: true,
                maximum_width: 2000,
                linear_growth_width: 2000
            })

            const loadbox = new LoadBox({ visible: true }, () => {
                const widget = new OpdsBox({
                    visible: true,
                    valign: Gtk.Align.START,
                    uri
                })
                widget.connect('loaded', () => {
                    const feed = widget.feed
                    if (!title) {
                        const title = feed.title || ''
                        label.label = title
                        label.tooltip_text = title
                    }
                    callback(feed)

                    const opdsbox = widget.get_child()
                    if (opdsbox instanceof OpdsNavigationBox) {
                        box.maximum_width = 700
                        opdsbox.connect('link-activated', (_, href) => {
                            this._pushHistory(uri)
                            this._loadOpds(href)
                        })
                    }
                })
                widget.connect('error', () => {
                    if (!title) label.label = _('Error')
                })
                return widget
            })

            box.add(loadbox)
            const scrolled = new Gtk.ScrolledWindow({ visible: true })
            scrolled.add(box)
            nb.append_page(scrolled, label)
            nb.child_set_property(scrolled, 'tab-expand', true)
        }
        makePage(uri, null, feed => {
            if (feed.title) this.title = feed.title
            const tabs = [].concat(feed.links).filter(link => 'href' in link
                && 'title' in link
                && link.rel !== 'self'
                && link.rel !== 'start'
                && link.rel !== 'search'
                && link.rel !== 'next'
                && link.rel !== 'alternate'
                && link.rel !== 'http://opds-spec.org/shelf'
                && link.rel !== 'http://opds-spec.org/subscriptions'
                && link.rel !== 'http://opds-spec.org/facet'
                && link.rel !== 'http://opds-spec.org/next'
                && link.rel !== 'http://opds-spec.org/crawlable')

            tabs.forEach(({ title, href }) => {
                makePage(href, title)
            })

            const facets = feed.links.filter(({ rel }) => rel === 'http://opds-spec.org/facet')
            if (facets.length) {
                const opdsbox = new OpdsNavigationBox({
                    visible: true,
                    facet: true,
                    margin: 18,
                    valign: Gtk.Align.START
                })
                opdsbox.load(facets.map(facet => ({
                    title: facet.title,
                    links: [facet]
                })))
                opdsbox.connect('link-activated', (_, href) => {
                    this._pushHistory(uri)
                    this._loadOpds(href)
                })

                const label = new Gtk.Label({
                    visible: true,
                    label: _('Filter'),
                })
                const box = new HdyColumn({ visible: true, maximum_width: 700 })
                box.add(opdsbox)
                const scrolled = new Gtk.ScrolledWindow({ visible: true })
                scrolled.add(box)
                nb.insert_page(scrolled, label, 0)
            }
        })
    }
})
