package app.rawboy.film

import android.content.Context
import app.rawboy.auto.looks.RetiredLooks
import app.rawboy.lut.LutData
import app.rawboy.lut.LutLoader
import org.json.JSONArray
import org.json.JSONObject

/**
 * A film stock simulated with spektrafilm (https://github.com/andreavolpato/spektrafilm, Andrea Volpato), as baked
 * with spektrafilm's LUT creator into assets/luts/spektrafilm (see CHANGELOG.txt there): a film LUT (Apple Log -> normalised film density) and a
 * print LUT (density -> sRGB), plus RawBoy's own grain, halation and scatter ([formation]) for shaders/film_form.glsl.
 */
class FilmStock(
    val id: String,
    val name: String,
    /** spektrafilm profile names; [print] is null for slides, which are scanned directly. */
    val film: String,
    val print: String?,
    val filmLut: String,
    val printLut: String,
    /** Density wire of the film LUT's output: D = code * (max - min) + min. */
    val densityMin: FloatArray,
    val densityMax: FloatArray,
    /** RawBoy's own grain, halation and scatter (shaders/film_form.glsl). */
    val formation: Formation = Formation.DEFAULT,
) {
    /**
     * Parameters of shaders/film_form.glsl, from formation.json (RawBoy's data, not spektrafilm's): per film layer
     * (C, M, Y) RMS granularity at net density 1 through a 48 um aperture, per channel the fraction of light the base
     * returns and its disc radius, and the in-emulsion scatter.
     */
    class Formation(
        val grainRms: FloatArray,
        val halation: FloatArray,
        val haloRadiusUm: Float,
        val scatter: FloatArray,
        val scatterUm: Float,
    ) {
        companion object {
            val DEFAULT = Formation(FloatArray(3), FloatArray(3), 0f, FloatArray(3), 0f)

            /** The stock [id] in formation.json, its own values over the file's defaults. */
            fun parse(json: JSONObject, id: String): Formation {
                val d = json.getJSONObject("defaults")
                val s = json.getJSONObject("stocks").optJSONObject(id) ?: return DEFAULT
                fun pick(key: String) = if (s.has(key)) s else d
                val rms = s.getDouble("rms").toFloat()
                val layers = d.getJSONArray("layerGrain").floats()
                return Formation(
                    grainRms = FloatArray(3) { rms * layers[it] },
                    halation = pick("halation").getJSONArray("halation").floats(),
                    haloRadiusUm = pick("haloRadiusUm").getDouble("haloRadiusUm").toFloat(),
                    scatter = pick("scatter").getJSONArray("scatter").floats(),
                    scatterUm = pick("scatterUm").getDouble("scatterUm").toFloat(),
                )
            }
        }
    }

    val filmLutId: String get() = "$ASSET_PREFIX$filmLut"
    val printLutId: String get() = "$ASSET_PREFIX$printLut"

    companion object {
        const val ASSET_DIR = "luts/spektrafilm"
        private const val ASSET_PREFIX = "asset:$ASSET_DIR/"

        fun parse(json: JSONObject, formation: JSONObject? = null): FilmStock {
            return FilmStock(
                id = json.getString("id"),
                name = json.getString("name"),
                film = json.getString("film"),
                print = if (json.isNull("print")) null else json.getString("print"),
                filmLut = json.getString("filmLut"),
                printLut = json.getString("printLut"),
                densityMin = json.getJSONArray("densityMin").floats(),
                densityMax = json.getJSONArray("densityMaxWire").floats(),
                formation = formation?.let { Formation.parse(it, json.getString("id")) } ?: Formation.DEFAULT,
            )
        }

        private fun JSONArray.floats() = FloatArray(length()) { getDouble(it).toFloat() }
    }
}

/** A stock with both its LUTs loaded, ready for [app.rawboy.gl.ShaderParams]. */
class FilmData(val stock: FilmStock, val film: LutData, val print: LutData)

/** The stocks in assets/luts/spektrafilm/stocks.json (baked from spektrafilm, see CHANGELOG.txt there). */
object FilmStocks {
    @Volatile
    private var cached: List<FilmStock>? = null

    fun all(context: Context): List<FilmStock> = cached ?: synchronized(this) {
        cached ?: run {
            fun json(name: String) =
                JSONObject(context.assets.open("${FilmStock.ASSET_DIR}/$name").bufferedReader().use { it.readText() })
            val formation = json("formation.json")
            val stocks = json("stocks.json").getJSONArray("stocks")
            List(stocks.length()) { FilmStock.parse(stocks.getJSONObject(it), formation) }
        }.also { cached = it }
    }

    fun byId(context: Context, id: String): FilmStock? =
        RetiredLooks.stock(id).let { key -> all(context).firstOrNull { it.id == key } }

    /** Loads both LUTs (LutLoader is synchronized and slow; callers cache the result). */
    fun load(context: Context, stock: FilmStock): FilmData =
        FilmData(stock, LutLoader.load(context, stock.filmLutId), LutLoader.load(context, stock.printLutId))
}
