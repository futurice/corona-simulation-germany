import { isValidDate } from '../utils.js';
import { map_goh_states_into_UFStates } from './gohs_seir_ode.js';

function initEstimates(days, shiftDays){
    const g = []
    for (var day=0-shiftDays; day<days; day++) {
        g[day] = {}
        g[day]['susceptible'] = 0
        g[day]['exposed'] = 0
        g[day]['infectious'] = 0
        g[day]['mild'] = 0
        g[day]['hospital_will_survive'] = 0
        g[day]['hospital_will_die'] = 0
        g[day]['recovered_mild'] = 0
        g[day]['recovered_hospital'] = 0
        g[day]['fatalities'] = 0
        g[day]['hospitalization_estimate'] = 0
        g[day]['active_hospitalizations'] = 0
        g[day]['icu'] = 0
    }
    return g
}

function estimateFatalities(estimates, rki_parsed, days, unrecorded_deaths){
// Estimate values for fatalities (assume unrecorded fatalities)
    for (var fatalityDay=0; fatalityDay<days; fatalityDay++) {
        const count = rki_parsed['cumulativeConfirmedDeaths'][fatalityDay]
        const adjustedCount = Math.round(count / (1 - unrecorded_deaths))
        estimates[fatalityDay]['fatalities'] = adjustedCount
    }
}

function estimateInfectious(estimates, adjustedCount, infectiousEndDay, infectiousStartDay){
    // Assume that all confirmed cases occur immediately after the infectious period (because diagnosis leads to self-isolation etc.)
    // Assume that all these confirmed cases were infectious for exactly D_infectious number of days
    for (var infectiousDay=infectiousEndDay; infectiousDay >= infectiousStartDay; infectiousDay--) {
        estimates[infectiousDay]['infectious'] += adjustedCount
    }
}


function estimateExposed(estimates,  adjustedCount, incubationEndDay, incubationStartDay){
    // Assume that all these confirmed cases were incubating for exactly D_incubation number of days (immediately preceding infectious period)
    for (var incubationDay=incubationEndDay; incubationDay >= incubationStartDay; incubationDay--) {
        estimates[incubationDay]['exposed'] += adjustedCount
    }
}

function estimateMild(estimates, days, mildStartDay, mildEndDay, mildCount){
    // Assume that proportion of people who isolate to home after diagnosis is (1 - P_SEVERE - CFR) (as opposed to hospitalization)
    for (var mildDay=mildStartDay; mildDay<=mildEndDay && mildDay<days; mildDay++) {
        estimates[mildDay]['mild'] += mildCount
    }
}

function estimateMildRecovery(estimates, mildRecoveredStartDay, mildCount, days){
    for (var recoveredDay=mildRecoveredStartDay; recoveredDay<days; recoveredDay++) {
        estimates[recoveredDay]['recovered_mild'] += mildCount
    }
}

function estimateRecoveredHospital(estimates, recHospStartDay, days, hospSurvivorCount){
    for (var recoveredDay=recHospStartDay; recoveredDay<days; recoveredDay++) {
        estimates[recoveredDay]['recovered_hospital'] += hospSurvivorCount
    }
}

function estimateHospitalization(estimates, hospStartDay, hospEndDay, days, hospCount){
    for (var hospDay=hospStartDay; hospDay<=hospEndDay && hospDay<days; hospDay++) {
        estimates[hospDay]['hospitalization_estimate'] += hospCount
    }
}

function estimateHospitalOutcome(estimates, days, proportionOfHospitaliedWhoWillDie){
    // Estimate values for goh states hospital_will_survive and hospital_will_die
    for (var day=0; day<days; day++) {
        // const countWard = hs_parsed['activeHospitalizations'][day]
        // const countIcu = hs_parsed['activeICU'][day]
        // const countBoth = countWard + countIcu
        estimates[day]['hospital_will_die'] = Math.round(proportionOfHospitaliedWhoWillDie * estimates[day]['hospitalization_estimate'])
        estimates[day]['hospital_will_survive'] = estimates[day]['hospitalization_estimate'] - estimates[day]['hospital_will_die']
    }
}

function estimateRegularAndICU(estimates, days, P_ICU){
    // Estimate values for goh states active_hospitalizations and active_ICU (Germany doesn't have this data in the API)
    for (var day=0; day<days; day++) {
        estimates[day]['icu'] = Math.round(P_ICU * estimates[day]['hospitalization_estimate'])
        estimates[day]['active_hospitalizations'] = estimates[day]['hospitalization_estimate'] - estimates[day]['icu']
    }
}

function shiftEstimates(estimates, days, shiftDays){
    // Cutoff days before day 0 (because we want to lock the first day to 25.3. instead of allowing it to move when the user tunes incubation parameter etc.)
    // Also cutoff days after lastDay-shiftDays (because we can't infer incubations until later, when confirmed cases come in.)
    const shifted = []
    for (var day=0; day<days-shiftDays; day++) {
        shifted[day] = estimates[day]
    }
    return shifted
}

function 
createGohStates(shifted, N){
    // Turn counts into goh states
    const goh_states = shifted.map(counts => {
        const count_susceptible = N - (counts['exposed'] + counts['infectious'] + counts['mild'] + counts['hospital_will_survive'] + counts['hospital_will_die'] + counts['recovered_mild'] + counts['recovered_hospital'] + counts['fatalities'])
        return [
            count_susceptible / N,
            counts['exposed'] / N,
            counts['infectious'] / N,
            counts['mild'] / N,
            0, // Removed state
            counts['hospital_will_survive'] / N,
            counts['hospital_will_die'] / N,
            counts['recovered_mild'] / N,
            counts['recovered_hospital'] / N,
            counts['fatalities'] / N
        ]
    })
    return goh_states
}

function createUserFacingStates(uf_states, estimates, days, shiftDays){
    // Map goh states into user facing states.
    for (var day=0; day<days-shiftDays; day++) {
        // Because goh states do not have ICU as a state, we'll put real ward and ICU values in there at this point.
        uf_states[day]['hospitalized'] = estimates[day]['active_hospitalizations']
        uf_states[day]['icu']          = estimates[day]['icu']
    }
}

export function createHistoricalEstimates(rki_parsed, N, D_incubation, D_infectious, D_recovery_mild, D_hospital, P_SEVERE, P_ICU, CFR, undetected_infections, unrecorded_deaths) {
    const days = rki_parsed['days']
    const first_date = new Date(rki_parsed['epidemyStartDate'])
    const shiftDays = Math.round(D_incubation + D_infectious)
    const estimates = initEstimates(days, shiftDays)

    estimateFatalities(estimates, rki_parsed, days, unrecorded_deaths)

    // Estimate values for other states.
    for (var confirmedCaseDay=0; confirmedCaseDay<days; confirmedCaseDay++) {

        // Assume undetected_infections
        const count = rki_parsed['newConfirmedCases'][confirmedCaseDay]
        const adjustedCount = Math.round(count / (1 - undetected_infections))

        const infectiousEndDay = confirmedCaseDay
        const infectiousStartDay = confirmedCaseDay - Math.round(D_infectious) + 1
        estimateInfectious(estimates, adjustedCount, infectiousEndDay, infectiousStartDay,)

        const incubationEndDay = infectiousStartDay - 1
        const incubationStartDay = incubationEndDay - Math.round(D_incubation) + 1
        estimateExposed(estimates, adjustedCount, incubationEndDay, incubationStartDay)

        const mildCount = Math.round((1 - P_SEVERE - CFR) * adjustedCount)
        const mildStartDay = infectiousEndDay+1
        const mildEndDay = mildStartDay + Math.round(D_recovery_mild) - 1
        estimateMild(estimates, days, mildStartDay, mildEndDay, mildCount)

        const mildRecoveredStartDay = mildEndDay+1
        estimateMildRecovery(estimates, mildRecoveredStartDay, mildCount, days)

        const hospSurvivorCount = Math.round(P_SEVERE * adjustedCount)
        const hospStartDay = infectiousEndDay + 1
        const hospEndDay = hospStartDay + Math.round(D_hospital) - 1
        const recHospStartDay = hospEndDay + 1
        estimateRecoveredHospital(estimates, recHospStartDay, days, hospSurvivorCount)

        const hospCount = Math.round((P_SEVERE + CFR) * adjustedCount)
        estimateHospitalization(estimates, hospStartDay, hospEndDay, days, hospCount)
        
    }

    const proportionOfHospitaliedWhoWillDie = CFR / (CFR + P_SEVERE)
    estimateHospitalOutcome(estimates, days, proportionOfHospitaliedWhoWillDie)

    estimateRegularAndICU(estimates, days, P_ICU)

    var shiftedStates = shiftEstimates(estimates, days, shiftDays)

    var goh_states = createGohStates(shiftedStates, N)

    var uf_states = map_goh_states_into_UFStates(goh_states, N, 0)
    createUserFacingStates(uf_states, estimates, days, shiftDays)
    
    
    return [first_date, goh_states, uf_states]
}