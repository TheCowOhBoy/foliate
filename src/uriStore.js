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

const { GLib, Gio } = imports.gi
const ByteArray = imports.byteArray
const { Storage, Obj, debug } = imports.utils

class UriStore {
    constructor() {
        const dataDir = GLib.get_user_data_dir()
        const path =  GLib.build_filenamev([dataDir, pkg.name, 'library/uri-store.json'])
        this._storage = new Storage(path)
        this._map = new Map(this._storage.get('uris'))
    }
    get(id) {
        return this._map.get(id)
    }
    set(id, uri) {
        this._map.set(id, uri)
        this._storage.set('uris', Array.from(this._map.entries()))
    }
    delete(id) {
        this._map.delete(id)
        this._storage.set('uris', Array.from(this._map.entries()))
    }
}

var uriStore = new UriStore()

const listDir = function* (path) {
    const dir = Gio.File.new_for_path(path)
    if (!GLib.file_test(path, GLib.FileTest.IS_DIR)) {
        debug(`"${path}" is not a directory`)
        return
    }
    const children = dir.enumerate_children('standard::name,time::modified',
        Gio.FileQueryInfoFlags.NONE, null)

    let info
    while ((info = children.next_file(null)) != null) {
        try {
            const name = info.get_name()
            if (!/\.json$/.test(name)) continue
            const child = dir.get_child(name)
            yield {
                identifier: decodeURIComponent(name.replace(/\.json$/, '')),
                file: child,
                modified: new Date(info.get_attribute_uint64('time::modified') * 1000)
            }
        } catch (e) {
            continue
        }
    }
}

class BookList {
    constructor() {
        this.list = new Gio.ListStore()
        this.list.append(new Obj('load-more'))
    }
    load() {
        const datadir = GLib.build_filenamev([GLib.get_user_data_dir(), pkg.name])
        const books = listDir(datadir) || []
        this._arr = Array.from(books).sort((a, b) => b.modified - a.modified)
        this._iter = this._arr.values()
    }
    next(n = 10) {
        let i = 0
        while (i < n) {
            const { value, done } = this._iter.next()
            if (done) {
                this.list.remove(this.list.get_n_items() - 1)
                return
            }
            const { identifier, file, modified } = value
            const [/*success*/, data, /*tag*/] = file.load_contents(null)
            const json = JSON.parse(data instanceof Uint8Array
                ? ByteArray.toString(data) : data.toString())

            if (!json.metadata) continue
            const result = {
                identifier,
                metadata: json.metadata,
                progress: json.progress,
                modified
            }
            this.list.insert(this.list.get_n_items() - 1, new Obj(result))
            i++
        }
    }
    remove(id) {
        const n = this.list.get_n_items()
        for (let i = 0; i < n; i++) {
            const item = this.list.get_item(i).value
            if (item.identifier === id) {
                this.list.remove(i)
                this.next(1)
                break
            }
        }
    }
    update(id, obj) {
        this.remove(id)
        this.list.insert(0, new Obj(obj))
    }
}

var bookList = new BookList()

