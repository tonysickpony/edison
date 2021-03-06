var csv = require("csv")
var generators = require("./generators.json")
var moment = require("moment-timezone")
var promisify = require("promisify-node")
var fs = promisify("fs")
var glob = require("glob")
var influx = require("influx")

// Configurable stuff

var client = influx({
    host: "45.63.27.151",
    port: 8086,
    protocol: "http",
    username: "datawrite",
    password: "datawrite",
    database: "aemo_data"
})

var write_from_this_date = moment([2016, 7, 7])

var write_until_this_date = moment([2016, 7, 13])

var generator_map = new Map()

generators.forEach(function (item) {

    generator_map.set(item.duid, item)

})

main(write_from_this_date)

function main (date) {

    var date_string = date.format("YYYYMMDD")

    console.log(date_string)

    glob(`data/${date_string}/*.CSV`, {}, (er, files) => {

        process_file(files, 0, date)

    })

}

function process_file (files, index, date) {

    fs.readFile(files[index])
        .then(parse_dispatch)
        .then(write_dispatch)
        .then(() => {

            console.log(`Finish writing data from ${files[index]}`)

            if (index === files.length - 1) {

                console.log("Move on to next date")

                var next_day = date.add(1, "d")

                if (next_day.isSameOrBefore(write_until_this_date)) {

                    return main(next_day)

                }

                return

            }

            console.log("scanning next file...")

            return process_file(files, index + 1, date)

        })
        .catch((err) => {

            console.log(err)

        })

}

function parse_dispatch (data) {

    console.log("Parse dispatch data")

    var lines = data
        .toString()
        .split("\n")

    lines.shift()

    var new_data = lines.join("\n")

    var options = {
        columns: true,
        relax_column_count: true
    }

    return new Promise(function (resolve, reject) {

        csv.parse(new_data, options, function (error, data) {

            if (error) {

                reject(error)

            }

            resolve(data)

        })

    })

}

function write_dispatch (data) {

    console.log("Write dispatch data")

    let dispatch_points = []

    let emission_points = []

    var unixTime = moment.tz(data[0].SETTLEMENTDATE, "YYYY/MM/DD HH:mm:ss", "Australia/Sydney").valueOf()

    data.forEach((datum) => {

        if (!datum.DUID) {

            return

        }

        var scada_value = +datum.SCADAVALUE

        if (scada_value < 0) {

            scada_value = 0

        }

        if (scada_value === 0) {

            return

        }

        var generator = generator_map.get(datum.DUID)

        if (!generator) {

            return

        }

        var tech_type = generator.feul

        var region = generator.region

        var emission_value = scada_value * generator["co2_emissions_factor"]

        // console.log(emission_value)

        dispatch_points.push([
            {
                value: scada_value,
                time: unixTime
            },
            {
                region: region,
                technology: tech_type,
                generator: datum.DUID
            }
        ])

        emission_points.push([
            {
                value: emission_value,
                time: unixTime
            },
            {
                region: region,
                technology: tech_type,
                generator: datum.DUID
            }
        ])

    })

    var series = {
        dispatch: dispatch_points,
        emission: emission_points
    }

    return new Promise(function (resolve, reject) {

        client.writeSeries(series, {db: "aemo_data"}, (error, response) => {

            if (error) {

                reject(error)

            }

            resolve()

        })

    })

}
